import "server-only";

import { randomUUID } from "node:crypto";
import {
  isNull,
  isNotNull,
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
  gte,
  lt,
  or,
} from "drizzle-orm";
import { getDb } from "@/db";
import { user as userTable } from "@/db/schema/auth";
import { asset as assetTable } from "@/db/schema/asset";
import { person as personTable } from "@/db/schema/family";
import { inboxItem } from "@/db/schema/inbox";
import {
  memoryEvent,
  memoryEventAsset,
  memoryEventParticipant,
  memoryEventRevision,
} from "@/db/schema/memory";
import { memoryEventTag } from "@/db/schema/suggestion";
import type { AssetRow } from "@/lib/assets/service";
import { indexMemoryEvent } from "@/lib/search/service";
import { getInboxEntry, type InboxEntry } from "@/lib/inbox/service";

/**
 * MemoryEvent 领域服务（Issue #008）。
 * 确认收件箱条目 → 创建事件；occurredAt 默认取 Asset capturedAt（不是 importedAt）。
 */

export type MemoryEventRow = typeof memoryEvent.$inferSelect;
export type PersonRow = typeof personTable.$inferSelect;

export const MILESTONE_TYPES = [
  "first_time",
  "growth",
  "family",
  "learning",
  "celebration",
  "other",
] as const;

export type MilestoneType = (typeof MILESTONE_TYPES)[number];

export const MILESTONE_TEMPLATES: ReadonlyArray<{
  type: MilestoneType;
  label: string;
  prompt: string;
}> = [
  { type: "first_time", label: "第一次", prompt: "第一次做到了一件什么事？" },
  { type: "growth", label: "成长", prompt: "最近发现了怎样的变化？" },
  { type: "learning", label: "学会了", prompt: "学会了什么新本领？" },
  { type: "family", label: "家庭时刻", prompt: "一家人共同经历了什么？" },
  { type: "celebration", label: "庆祝", prompt: "今天在庆祝什么？" },
  { type: "other", label: "值得记住", prompt: "为什么想把这一刻特别留下？" },
];

export function isMilestoneType(value: unknown): value is MilestoneType {
  return typeof value === "string" && MILESTONE_TYPES.includes(value as MilestoneType);
}

export type MemoryEventDetail = {
  event: MemoryEventRow;
  assets: AssetRow[];
  participants: PersonRow[];
  sourceNotes: Array<{
    id: string;
    rawText: string;
    createdAt: Date;
  }>;
};

/**
 * 编辑记忆事件（RH-003）。
 * 允许修改：title / occurredAt / occurredAtPrecision / locationText /
 * coverAsset / participants / childPersonId（须为本家庭的孩子 Person）。
 * 不可修改：importedAt（Asset 层语义）、Asset.capturedAt（与 Event occurredAt 是两回事，
 * 编辑事件绝不联动改素材时间）。
 * 安全：family/event/person/asset 所有权逐项校验（防 IDOR）；
 * 编辑者记录在 lastEditedByUserId；ageDays 快照按新 occurredAt 重算。
 */
export type EditMemoryEventPatch = {
  title?: string;
  occurredAt?: Date;
  occurredAtPrecision?: "exact" | "approximate" | "date_only";
  locationText?: string | null;
  coverAssetId?: string | null;
  participantPersonIds?: string[];
  childPersonId?: string;
  milestoneType?: MilestoneType | null;
  isPinned?: boolean;
};

export type EditResult =
  | { ok: true; event: MemoryEventRow }
  | { ok: false; error: "not_found" | "invalid" | "bad_person" | "bad_cover" };

export async function updateMemoryEvent(
  familyId: string,
  eventId: string,
  editorUserId: string,
  patch: EditMemoryEventPatch,
): Promise<EditResult> {
  const db = getDb();
  const rows = await db
    .select()
    .from(memoryEvent)
    .where(
      and(
        eq(memoryEvent.familyId, familyId),
        eq(memoryEvent.id, eventId),
        isNull(memoryEvent.deletedAt),
      ),
    )
    .limit(1);
  const current = rows[0];
  if (!current) return { ok: false, error: "not_found" };

  const title = patch.title !== undefined ? patch.title.trim() : current.title;
  if (title.length < 1 || title.length > 100) return { ok: false, error: "invalid" };
  const occurredAt = patch.occurredAt ?? current.occurredAt;
  if (Number.isNaN(occurredAt.getTime())) return { ok: false, error: "invalid" };
  const precision =
    patch.occurredAtPrecision ?? (current.occurredAtPrecision as "exact");
  const locationText =
    patch.locationText !== undefined
      ? patch.locationText === null
        ? null
        : patch.locationText.trim().slice(0, 200) || null
      : current.locationText;
  const milestoneType =
    patch.milestoneType !== undefined ? patch.milestoneType : current.milestoneType;
  if (milestoneType !== null && !isMilestoneType(milestoneType)) {
    return { ok: false, error: "invalid" };
  }
  if (patch.isPinned !== undefined && typeof patch.isPinned !== "boolean") {
    return { ok: false, error: "invalid" };
  }
  const isPinned = patch.isPinned ?? current.isPinned;

  // childPersonId：如提供，必须仍是本家庭的孩子 Person
  let childPersonId = current.childPersonId;
  if (patch.childPersonId !== undefined && patch.childPersonId !== current.childPersonId) {
    const child = await db
      .select({ id: personTable.id })
      .from(personTable)
      .where(
        and(
          eq(personTable.familyId, familyId),
          eq(personTable.id, patch.childPersonId),
          eq(personTable.isChild, true),
        ),
      )
      .limit(1);
    if (!child[0]) return { ok: false, error: "bad_person" };
    childPersonId = patch.childPersonId;
  }

  // participants：全部必须属于本家庭（含新孩子本人）
  const existingParticipantRows = await db
    .select({ personId: memoryEventParticipant.personId })
    .from(memoryEventParticipant)
    .where(eq(memoryEventParticipant.memoryEventId, eventId));
  const participantIdsBefore = existingParticipantRows.map((l) => l.personId);
  let participantIds: string[];
  if (patch.participantPersonIds !== undefined) {
    if (patch.participantPersonIds.length > 50) return { ok: false, error: "invalid" };
    const wanted = [...new Set([childPersonId, ...patch.participantPersonIds])];
    const valid = await db
      .select({ id: personTable.id })
      .from(personTable)
      .where(
        and(
          eq(personTable.familyId, familyId),
          inArray(personTable.id, wanted),
        ),
      );
    const validSet = new Set(valid.map((p) => p.id));
    if (wanted.some((id) => !validSet.has(id))) {
      return { ok: false, error: "bad_person" };
    }
    participantIds = wanted;
  } else {
    participantIds = [...participantIdsBefore];
    if (!participantIds.includes(childPersonId)) participantIds.unshift(childPersonId);
  }

  // cover：如提供，必须属于本家庭（不强制属于本事件——允许把库里任一照片设为封面）
  let coverAssetId = current.coverAssetId;
  if (patch.coverAssetId !== undefined) {
    if (patch.coverAssetId === null) {
      coverAssetId = null;
    } else {
      const cover = await db
        .select({ id: assetTable.id })
        .from(assetTable)
        .where(
          and(
            eq(assetTable.familyId, familyId),
            eq(assetTable.id, patch.coverAssetId),
          ),
        )
        .limit(1);
      if (!cover[0]) return { ok: false, error: "bad_cover" };
      coverAssetId = patch.coverAssetId;
    }
  }

  // ageDays 快照按（可能新的）孩子生日与 occurredAt 重算
  const childBirth = await db
    .select({ birthDate: personTable.birthDate })
    .from(personTable)
    .where(eq(personTable.id, childPersonId))
    .limit(1);
  const ageDays =
    childBirth[0]?.birthDate != null
      ? computeAgeDays(childBirth[0].birthDate, occurredAt)
      : null;

  const now = new Date();
  db.transaction((tx) => {
    // 编辑前快照（v0.1.3）：与本次修改同事务写入，保证可追溯
    tx.insert(memoryEventRevision)
      .values({
        id: randomUUID(),
        familyId,
        memoryEventId: eventId,
        editedByUserId: editorUserId,
        snapshotJson: JSON.stringify({
          title: current.title,
          occurredAt: current.occurredAt.toISOString(),
          occurredAtPrecision: current.occurredAtPrecision,
          locationText: current.locationText,
          coverAssetId: current.coverAssetId,
          childPersonId: current.childPersonId,
          participantPersonIds: participantIdsBefore,
          milestoneType: current.milestoneType,
          isPinned: current.isPinned,
          ageDays: current.ageDays,
        }),
        createdAt: now,
      })
      .run();

    tx.update(memoryEvent)
      .set({
        title,
        occurredAt,
        occurredAtPrecision: precision,
        locationText,
        coverAssetId,
        childPersonId,
        milestoneType,
        isPinned,
        ageDays,
        lastEditedByUserId: editorUserId,
        updatedAt: now,
      })
      .where(and(eq(memoryEvent.familyId, familyId), eq(memoryEvent.id, eventId)))
      .run();

    if (patch.participantPersonIds !== undefined) {
      tx.delete(memoryEventParticipant)
        .where(eq(memoryEventParticipant.memoryEventId, eventId))
        .run();
      tx.insert(memoryEventParticipant)
        .values(
          participantIds.map((personId) => ({
            id: randomUUID(),
            memoryEventId: eventId,
            personId,
            familyId,
            createdAt: now,
          })),
        )
        .run();
    }
  });

  indexMemoryEvent({ id: eventId, familyId, title, childPersonId });
  const updated = await getMemoryEventDetail(familyId, eventId);
  return { ok: true, event: updated!.event };
}

/** occurredAt 默认值：最早的可信 capturedAt；全都没有时用最早 importedAt */
export function defaultOccurredAt(assets: AssetRow[], rawTextItem?: { createdAt: Date }): Date {
  const captured = assets
    .map((a) => a.capturedAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  if (captured.length > 0) return captured[0];
  const imported = assets
    .map((a) => a.importedAt)
    .sort((a, b) => a.getTime() - b.getTime());
  if (imported.length > 0) return imported[0];
  return rawTextItem?.createdAt ?? new Date();
}

/** 默认标题：文本取正文截断；素材取展示名去扩展名 */
export function defaultTitle(entry: InboxEntry): string {
  if (entry.item.draftTitle?.trim()) return entry.item.draftTitle.trim();
  if (entry.item.kind === "text" && entry.item.rawText) {
    const text = entry.item.rawText.trim();
    return text.length > 30 ? `${text.slice(0, 30)}…` : text;
  }
  const first = entry.assets[0]?.originalFilename ?? "一段记忆";
  return first.replace(/\.[a-z0-9]{1,8}$/i, "");
}

/** 满天数快照：出生前为负；展示层永远现算（#009） */
export function computeAgeDays(birthDate: string, at: Date): number | null {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return null;
  const atDay = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const birthDay = birth.getTime();
  return Math.floor((atDay - birthDay) / 86_400_000);
}

async function getChildPersonId(familyId: string): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ id: personTable.id })
    .from(personTable)
    .where(and(eq(personTable.familyId, familyId), eq(personTable.isChild, true)))
    .orderBy(asc(personTable.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

export type ConfirmOptions = {
  title?: string;
  occurredAt?: Date;
  occurredAtPrecision?: "exact" | "approximate" | "date_only";
  locationText?: string | null;
  participantPersonIds?: string[];
  coverAssetId?: string;
};

export type ConfirmResult =
  | { ok: true; eventId: string }
  | { ok: false; error: "not_found" | "no_child" | "invalid" };

/**
 * 确认收件箱条目为 MemoryEvent（事务）：
 * 创建事件 → 关联 Assets → 关联 Participants → InboxItem confirmed。
 * Assets 不复制，只建关系。
 */
export async function confirmInboxEntry(
  familyId: string,
  entry: InboxEntry,
  opts: ConfirmOptions = {},
): Promise<ConfirmResult> {
  const liveEntry = await getInboxEntry(familyId, entry.item.id);
  if (!liveEntry) return { ok: false, error: "not_found" };
  if (
    liveEntry.item.status === "confirmed" &&
    liveEntry.item.memoryEventId
  ) {
    return { ok: true, eventId: liveEntry.item.memoryEventId };
  }
  if (!["new", "needs_review", "processing"].includes(liveEntry.item.status)) {
    return { ok: false, error: "not_found" };
  }
  const requestedAssetIds = [...new Set(entry.assets.map((asset) => asset.id))];
  let confirmedAssets = liveEntry.assets;
  if (requestedAssetIds.length > 0) {
    confirmedAssets = await getDb()
      .select()
      .from(assetTable)
      .where(
        and(
          eq(assetTable.familyId, familyId),
          inArray(assetTable.id, requestedAssetIds),
        ),
      );
    if (confirmedAssets.length !== requestedAssetIds.length) {
      return { ok: false, error: "invalid" };
    }
  }
  entry = { ...liveEntry, assets: confirmedAssets };
  const childPersonId = await getChildPersonId(familyId);
  if (!childPersonId) return { ok: false, error: "no_child" };

  const title = (opts.title ?? defaultTitle(entry)).trim();
  if (title.length < 1 || title.length > 100) return { ok: false, error: "invalid" };

  const occurredAt = opts.occurredAt ?? entry.item.draftOccurredAt ?? defaultOccurredAt(entry.assets, entry.item);
  const precision = opts.occurredAtPrecision ?? "exact";

  const db = getDb();
  const eventId = randomUUID();
  const now = new Date();

  // 参与人默认：孩子本人
  const participantIds = new Set<string>([childPersonId]);
  for (const pid of opts.participantPersonIds ?? entry.participantPersonIds) participantIds.add(pid);
  // 校验参与者都属于本家庭
  const validParticipants = await db
    .select({ id: personTable.id })
    .from(personTable)
    .where(
      and(
        eq(personTable.familyId, familyId),
        inArray(personTable.id, [...participantIds]),
      ),
    );
  const validIds = new Set(validParticipants.map((p) => p.id));
  if ([...participantIds].some((personId) => !validIds.has(personId))) {
    return { ok: false, error: "invalid" };
  }
  const locationText = (opts.locationText === undefined
    ? entry.item.draftLocationText
    : opts.locationText)?.trim().slice(0, 200) || null;

  // cover 必须来自本事件的 assets
  const assetIds = entry.assets.map((a) => a.id);
  const coverAssetId =
    opts.coverAssetId && assetIds.includes(opts.coverAssetId)
      ? opts.coverAssetId
      : (entry.assets.find((a) => a.type === "image")?.id ?? entry.assets[0]?.id ?? null);

  const childBirth = await db
    .select({ birthDate: personTable.birthDate })
    .from(personTable)
    .where(eq(personTable.id, childPersonId))
    .limit(1);
  const ageDays =
    childBirth[0]?.birthDate != null
      ? computeAgeDays(childBirth[0].birthDate, occurredAt)
      : null;

  db.transaction((tx) => {
    tx.insert(memoryEvent)
      .values({
        id: eventId,
        familyId,
        childPersonId,
        title,
        occurredAt,
        occurredAtPrecision: precision,
        locationText,
        coverAssetId,
        status: "confirmed",
        ageDays,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    if (assetIds.length > 0) {
      tx.insert(memoryEventAsset)
        .values(
          assetIds.map((assetId) => ({
            id: randomUUID(),
            memoryEventId: eventId,
            assetId,
            familyId,
            createdAt: now,
          })),
        )
        .run();
    }
    tx.insert(memoryEventParticipant)
      .values(
        [...validIds].map((personId) => ({
          id: randomUUID(),
          memoryEventId: eventId,
          personId,
          familyId,
          createdAt: now,
        })),
      )
      .run();
    tx.update(inboxItem)
      .set({ status: "confirmed", memoryEventId: eventId, updatedAt: now })
      .where(
        and(
          eq(inboxItem.familyId, familyId),
          eq(inboxItem.id, entry.item.id),
        ),
      )
      .run();
  });

  indexMemoryEvent({ id: eventId, familyId, title, childPersonId });
  return { ok: true, eventId };
}

export type MergeOptions = {
  title: string;
  occurredAt?: Date;
  locationText?: string | null;
  participantPersonIds?: string[];
  coverAssetId?: string;
};

/**
 * 多个收件箱条目合并为一个 MemoryEvent（#010）：
 * - Assets 只关联不复制；
 * - occurredAt 默认取全部素材中最早的可信 capturedAt；
 * - 全部条目置 confirmed。
 */
export async function mergeInboxEntries(
  familyId: string,
  itemIds: string[],
  opts: MergeOptions,
): Promise<ConfirmResult> {
  if (itemIds.length < 2) return { ok: false, error: "invalid" };
  const title = opts.title.trim();
  if (title.length < 1 || title.length > 100) return { ok: false, error: "invalid" };

  const entries: InboxEntry[] = [];
  const seenAssets = new Set<string>();
  const assets: AssetRow[] = [];
  for (const itemId of itemIds) {
    const entry = await getInboxEntry(familyId, itemId);
    if (!entry) return { ok: false, error: "not_found" };
    if (!["new", "needs_review", "processing"].includes(entry.item.status)) {
      return { ok: false, error: "not_found" };
    }
    entries.push(entry);
    for (const a of entry.assets) {
      if (!seenAssets.has(a.id)) {
        seenAssets.add(a.id);
        assets.push(a);
      }
    }
  }

  const childPersonId = await getChildPersonId(familyId);
  if (!childPersonId) return { ok: false, error: "no_child" };

  const occurredAt =
    opts.occurredAt ??
    defaultOccurredAt(assets, entries[0].item);
  const assetIds = assets.map((a) => a.id);
  const coverAssetId =
    opts.coverAssetId && assetIds.includes(opts.coverAssetId)
      ? opts.coverAssetId
      : (assets.find((a) => a.type === "image")?.id ?? assets[0]?.id ?? null);

  const db = getDb();
  const eventId = randomUUID();
  const now = new Date();

  const childBirth = await db
    .select({ birthDate: personTable.birthDate })
    .from(personTable)
    .where(eq(personTable.id, childPersonId))
    .limit(1);
  const ageDays =
    childBirth[0]?.birthDate != null
      ? computeAgeDays(childBirth[0].birthDate, occurredAt)
      : null;
  const participantIds = new Set<string>([
    childPersonId,
    ...(opts.participantPersonIds ?? []),
  ]);
  if (participantIds.size > 50) return { ok: false, error: "invalid" };
  const validParticipants = await db
    .select({ id: personTable.id })
    .from(personTable)
    .where(
      and(
        eq(personTable.familyId, familyId),
        inArray(personTable.id, [...participantIds]),
      ),
    );
  const validParticipantIds = new Set(validParticipants.map((row) => row.id));
  if ([...participantIds].some((personId) => !validParticipantIds.has(personId))) {
    return { ok: false, error: "invalid" };
  }
  const locationText = opts.locationText?.trim().slice(0, 200) || null;

  db.transaction((tx) => {
    tx.insert(memoryEvent)
      .values({
        id: eventId,
        familyId,
        childPersonId,
        title,
        occurredAt,
        occurredAtPrecision: "exact",
        locationText,
        coverAssetId,
        status: "confirmed",
        ageDays,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    if (assetIds.length > 0) {
      tx.insert(memoryEventAsset)
        .values(
          assetIds.map((assetId) => ({
            id: randomUUID(),
            memoryEventId: eventId,
            assetId,
            familyId,
            createdAt: now,
          })),
        )
        .run();
    }
    tx.insert(memoryEventParticipant)
      .values(
        [...validParticipantIds].map((personId) => ({
          id: randomUUID(),
          memoryEventId: eventId,
          personId,
          familyId,
          createdAt: now,
        })),
      )
      .run();
    // 涉及的全部条目都确认掉
    tx.update(inboxItem)
      .set({ status: "confirmed", memoryEventId: eventId, updatedAt: now })
      .where(
        and(
          eq(inboxItem.familyId, familyId),
          inArray(inboxItem.id, itemIds),
        ),
      )
      .run();
  });

  indexMemoryEvent({ id: eventId, familyId, title, childPersonId });
  return { ok: true, eventId };
}

export async function getMemoryEventDetail(  familyId: string,
  eventId: string,
): Promise<MemoryEventDetail | undefined> {
  const db = getDb();
  const events = await db
    .select()
    .from(memoryEvent)
    .where(
      and(
        eq(memoryEvent.familyId, familyId),
        eq(memoryEvent.id, eventId),
        isNull(memoryEvent.deletedAt),
      ),
    )
    .limit(1);
  if (!events[0]) return undefined;

  const assetLinks = await db
    .select({ assetId: memoryEventAsset.assetId })
    .from(memoryEventAsset)
    .where(eq(memoryEventAsset.memoryEventId, eventId));
  const assets =
    assetLinks.length > 0
      ? await db
          .select()
          .from(assetTable)
          .where(
            inArray(
              assetTable.id,
              assetLinks.map((l) => l.assetId),
            ),
          )
          .orderBy(asc(assetTable.capturedAt), asc(assetTable.createdAt))
      : [];

  const participantLinks = await db
    .select({ personId: memoryEventParticipant.personId })
    .from(memoryEventParticipant)
    .where(eq(memoryEventParticipant.memoryEventId, eventId));
  const participants =
    participantLinks.length > 0
      ? await db
          .select()
          .from(personTable)
          .where(
            inArray(
              personTable.id,
              participantLinks.map((l) => l.personId),
            ),
          )
          .orderBy(asc(personTable.createdAt))
      : [];

  const linkedTextItems = await db
    .select({
      id: inboxItem.id,
      rawText: inboxItem.rawText,
      createdAt: inboxItem.createdAt,
    })
    .from(inboxItem)
    .where(
      and(
        eq(inboxItem.familyId, familyId),
        eq(inboxItem.memoryEventId, eventId),
        eq(inboxItem.kind, "text"),
      ),
    )
    .orderBy(asc(inboxItem.createdAt));
  const sourceNotes = linkedTextItems.flatMap((item) =>
    item.rawText === null
      ? []
      : [{ id: item.id, rawText: item.rawText, createdAt: item.createdAt }],
  );

  return { event: events[0], assets, participants, sourceNotes };
}

export async function listMemoryEvents(
  familyId: string,
  limit = 100,
): Promise<MemoryEventRow[]> {
  const db = getDb();
  return db
    .select()
    .from(memoryEvent)
    .where(
      and(
        eq(memoryEvent.familyId, familyId),
        eq(memoryEvent.status, "confirmed"),
        isNull(memoryEvent.deletedAt),
      ),
    )
    .orderBy(desc(memoryEvent.occurredAt))
    .limit(limit);
}

// ---------- 编辑历史（v0.1.3） ----------

export type EventRevision = {
  id: string;
  editedByUserId: string | null;
  editorName: string | null;
  createdAt: Date;
  snapshot: {
    title: string;
    occurredAt: string;
    occurredAtPrecision: string;
    locationText: string | null;
    coverAssetId: string | null;
    childPersonId: string;
    participantPersonIds: string[];
    milestoneType?: string | null;
    isPinned?: boolean;
    ageDays: number | null;
  };
};

/** 事件的编辑历史（新→旧）；跨家庭返回空（事件本身按 family 校验） */
export async function listEventRevisions(
  familyId: string,
  eventId: string,
): Promise<EventRevision[]> {
  const db = getDb();
  const owned = await db
    .select({ id: memoryEvent.id })
    .from(memoryEvent)
    .where(and(eq(memoryEvent.familyId, familyId), eq(memoryEvent.id, eventId)))
    .limit(1);
  if (!owned[0]) return [];
  const rows = await db
    .select({
      revision: memoryEventRevision,
      editorName: userTable.name,
    })
    .from(memoryEventRevision)
    .leftJoin(userTable, eq(memoryEventRevision.editedByUserId, userTable.id))
    .where(eq(memoryEventRevision.memoryEventId, eventId))
    .orderBy(desc(memoryEventRevision.createdAt));
  return rows.map((r) => ({
    id: r.revision.id,
    editedByUserId: r.revision.editedByUserId,
    editorName: r.editorName ?? null,
    createdAt: r.revision.createdAt,
    snapshot: JSON.parse(r.revision.snapshotJson) as EventRevision["snapshot"],
  }));
}

export type TimelineEntry = {
  event: MemoryEventRow;
  coverAssetId: string | null;
  coverAssetType: string | null;
  coverAssetMime: string | null;
  coverThumbAssetId: string | null;
  assetCount: number;
  participantNames: string[];
  tags: string[];
};

const DEFAULT_TIMELINE_PAGE_SIZE = 25;
const MAX_TIMELINE_PAGE_SIZE = 50;

type TimelineCursorPayload = {
  v: 1;
  occurredAtMs: number;
  eventId: string;
};

export type TimelinePage = {
  entries: TimelineEntry[];
  nextCursor: string | null;
};

/**
 * Hydrate a bounded event set into card-ready data with batch queries. This is
 * shared by the timeline, resurfacing and milestone read models so none of
 * those pages performs per-memory lookups.
 */
export async function hydrateTimelineEntries(
  familyId: string,
  events: MemoryEventRow[],
): Promise<TimelineEntry[]> {
  if (events.length === 0) return [];
  const db = getDb();
  const eventIds = events.map((event) => event.id);

  const [assetLinks, coverAssets, participantLinks, tagRows] = await Promise.all([
    db
      .select({
        memoryEventId: memoryEventAsset.memoryEventId,
        assetId: memoryEventAsset.assetId,
        type: assetTable.type,
        mimeType: assetTable.mimeType,
      })
      .from(memoryEventAsset)
      .innerJoin(assetTable, eq(memoryEventAsset.assetId, assetTable.id))
      .where(
        and(
          eq(memoryEventAsset.familyId, familyId),
          eq(assetTable.familyId, familyId),
          inArray(memoryEventAsset.memoryEventId, eventIds),
        ),
      )
      .orderBy(asc(memoryEventAsset.createdAt), asc(memoryEventAsset.id)),
    (() => {
      const coverIds = [
        ...new Set(
          events
            .map((event) => event.coverAssetId)
            .filter((id): id is string => id !== null),
        ),
      ];
      return coverIds.length > 0
        ? db
            .select({
              id: assetTable.id,
              type: assetTable.type,
              mimeType: assetTable.mimeType,
            })
            .from(assetTable)
            .where(
              and(
                eq(assetTable.familyId, familyId),
                inArray(assetTable.id, coverIds),
              ),
            )
        : Promise.resolve([]);
    })(),
    db
      .select({
        memoryEventId: memoryEventParticipant.memoryEventId,
        personId: memoryEventParticipant.personId,
        displayName: personTable.displayName,
      })
      .from(memoryEventParticipant)
      .innerJoin(personTable, eq(memoryEventParticipant.personId, personTable.id))
      .where(
        and(
          eq(memoryEventParticipant.familyId, familyId),
          eq(personTable.familyId, familyId),
          inArray(memoryEventParticipant.memoryEventId, eventIds),
        ),
      )
      .orderBy(asc(memoryEventParticipant.createdAt), asc(memoryEventParticipant.id)),
    db
      .select({
        memoryEventId: memoryEventTag.memoryEventId,
        tag: memoryEventTag.tag,
      })
      .from(memoryEventTag)
      .where(
        and(
          eq(memoryEventTag.familyId, familyId),
          inArray(memoryEventTag.memoryEventId, eventIds),
        ),
      )
      .orderBy(asc(memoryEventTag.tag)),
  ]);

  const assetLinksByEvent = new Map<string, typeof assetLinks>();
  for (const link of assetLinks) {
    const links = assetLinksByEvent.get(link.memoryEventId) ?? [];
    links.push(link);
    assetLinksByEvent.set(link.memoryEventId, links);
  }
  const coverById = new Map(coverAssets.map((asset) => [asset.id, asset]));
  const participantNamesByEvent = new Map<string, string[]>();
  for (const link of participantLinks) {
    const names = participantNamesByEvent.get(link.memoryEventId) ?? [];
    names.push(link.displayName);
    participantNamesByEvent.set(link.memoryEventId, names);
  }
  const tagsByEvent = new Map<string, string[]>();
  for (const row of tagRows) {
    const tags = tagsByEvent.get(row.memoryEventId) ?? [];
    tags.push(row.tag);
    tagsByEvent.set(row.memoryEventId, tags);
  }
  const coverIdsForThumb = [
    ...new Set(
      events
        .map((event) => {
          if (event.coverAssetId) return event.coverAssetId;
          return assetLinksByEvent
            .get(event.id)
            ?.find((link) => link.type === "image")?.assetId;
        })
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const { getThumbnailMap } = await import("@/lib/assets/service");
  const thumbByOriginal = await getThumbnailMap(familyId, coverIdsForThumb);

  return events.map((event): TimelineEntry => {
    const links = assetLinksByEvent.get(event.id) ?? [];
    const fallbackImage = links.find((link) => link.type === "image");
    const fallbackAsset = fallbackImage ?? links[0];
    const coverId = event.coverAssetId ?? fallbackImage?.assetId ?? null;
    const explicitCover = coverId ? coverById.get(coverId) : undefined;
    const linkedCover = coverId
      ? links.find((link) => link.assetId === coverId)
      : undefined;
    return {
      event,
      coverAssetId: coverId,
      coverAssetType:
        explicitCover?.type ?? linkedCover?.type ?? fallbackAsset?.type ?? null,
      coverAssetMime:
        explicitCover?.mimeType ??
        linkedCover?.mimeType ??
        fallbackAsset?.mimeType ??
        null,
      coverThumbAssetId: coverId
        ? (thumbByOriginal.get(coverId)?.id ?? null)
        : null,
      assetCount: links.length,
      participantNames: participantNamesByEvent.get(event.id) ?? [],
      tags: tagsByEvent.get(event.id) ?? [],
    };
  });
}

function encodeTimelineCursor(event: MemoryEventRow): string {
  const payload: TimelineCursorPayload = {
    v: 1,
    occurredAtMs: event.occurredAt.getTime(),
    eventId: event.id,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeTimelineCursor(value: string | null | undefined): TimelineCursorPayload | null {
  if (!value || value.length > 512) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<TimelineCursorPayload>;
    if (
      parsed.v !== 1 ||
      typeof parsed.occurredAtMs !== "number" ||
      !Number.isSafeInteger(parsed.occurredAtMs) ||
      typeof parsed.eventId !== "string" ||
      parsed.eventId.length === 0 ||
      parsed.eventId.length > 128
    ) {
      return null;
    }
    const occurredAt = new Date(parsed.occurredAtMs);
    if (Number.isNaN(occurredAt.getTime())) return null;
    return {
      v: 1,
      occurredAtMs: parsed.occurredAtMs,
      eventId: parsed.eventId,
    };
  } catch {
    return null;
  }
}

function timelinePageSize(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || !value || value < 1) {
    return DEFAULT_TIMELINE_PAGE_SIZE;
  }
  return Math.min(value, MAX_TIMELINE_PAGE_SIZE);
}

/**
 * Stable keyset page ordered by (occurredAt DESC, id DESC). The opaque cursor
 * keeps request cost proportional to one page even after decades of events.
 */
export async function getTimelinePage(
  familyId: string,
  options: {
    cursor?: string | null;
    limit?: number;
    personId?: string | null;
    mediaType?: "image" | "audio" | "video" | null;
    tag?: string | null;
    occurredFrom?: Date | null;
    occurredBefore?: Date | null;
  } = {},
): Promise<TimelinePage> {
  const db = getDb();
  const limit = timelinePageSize(options.limit);
  const cursor = decodeTimelineCursor(options.cursor);
  const cursorFilter = cursor
    ? sql`(${memoryEvent.occurredAt}, ${memoryEvent.id}) < (${Math.floor(cursor.occurredAtMs / 1000)}, ${cursor.eventId})`
    : undefined;
  const eventRows = await db
    .select()
    .from(memoryEvent)
    .where(
      and(
        eq(memoryEvent.familyId, familyId),
        eq(memoryEvent.status, "confirmed"),
        isNull(memoryEvent.deletedAt),
        options.personId
          ? sql`exists (
              select 1 from memory_event_participant timeline_person
              where timeline_person.family_id = ${familyId}
                and timeline_person.memory_event_id = ${memoryEvent.id}
                and timeline_person.person_id = ${options.personId}
            )`
          : undefined,
        options.mediaType
          ? sql`exists (
              select 1 from memory_event_asset timeline_link
              inner join asset timeline_asset on timeline_asset.id = timeline_link.asset_id
              where timeline_link.family_id = ${familyId}
                and timeline_asset.family_id = ${familyId}
                and timeline_link.memory_event_id = ${memoryEvent.id}
                and timeline_asset.type = ${options.mediaType}
            )`
          : undefined,
        options.tag
          ? sql`exists (
              select 1 from memory_event_tag timeline_tag
              where timeline_tag.family_id = ${familyId}
                and timeline_tag.memory_event_id = ${memoryEvent.id}
                and timeline_tag.tag = ${options.tag}
            )`
          : undefined,
        options.occurredFrom ? gte(memoryEvent.occurredAt, options.occurredFrom) : undefined,
        options.occurredBefore ? lt(memoryEvent.occurredAt, options.occurredBefore) : undefined,
        cursorFilter,
      ),
    )
    .orderBy(desc(memoryEvent.occurredAt), desc(memoryEvent.id))
    .limit(limit + 1);

  const hasMore = eventRows.length > limit;
  const events = hasMore ? eventRows.slice(0, limit) : eventRows;
  if (events.length === 0) return { entries: [], nextCursor: null };
  const entries = await hydrateTimelineEntries(familyId, events);

  return {
    entries,
    nextCursor: hasMore ? encodeTimelineCursor(events.at(-1)!) : null,
  };
}

/** Pinned memories first, then newest milestones. */
export async function listMilestoneEntries(
  familyId: string,
  limit = 6,
): Promise<TimelineEntry[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 24);
  const events = await getDb()
    .select()
    .from(memoryEvent)
    .where(
      and(
        eq(memoryEvent.familyId, familyId),
        eq(memoryEvent.status, "confirmed"),
        isNull(memoryEvent.deletedAt),
        or(eq(memoryEvent.isPinned, true), isNotNull(memoryEvent.milestoneType)),
      ),
    )
    .orderBy(desc(memoryEvent.isPinned), desc(memoryEvent.occurredAt), desc(memoryEvent.id))
    .limit(safeLimit);
  return hydrateTimelineEntries(familyId, events);
}

/** Family-scoped, soft-delete-safe batch lookup for secondary read models. */
export async function getTimelineEntriesByIds(
  familyId: string,
  eventIds: readonly string[],
): Promise<TimelineEntry[]> {
  const ids = [...new Set(eventIds)].slice(0, 100);
  if (ids.length === 0) return [];
  const rows = await getDb()
    .select()
    .from(memoryEvent)
    .where(
      and(
        eq(memoryEvent.familyId, familyId),
        eq(memoryEvent.status, "confirmed"),
        isNull(memoryEvent.deletedAt),
        inArray(memoryEvent.id, ids),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return hydrateTimelineEntries(
    familyId,
    ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    }),
  );
}

export type TimelineFacets = { tags: string[]; years: number[] };

/** Family-scoped filter vocabulary for the timeline controls. */
export async function getTimelineFacets(familyId: string): Promise<TimelineFacets> {
  const db = getDb();
  const [tagRows, yearRows] = await Promise.all([
    db
      .selectDistinct({ tag: memoryEventTag.tag })
      .from(memoryEventTag)
      .innerJoin(memoryEvent, eq(memoryEventTag.memoryEventId, memoryEvent.id))
      .where(
        and(
          eq(memoryEventTag.familyId, familyId),
          eq(memoryEvent.familyId, familyId),
          eq(memoryEvent.status, "confirmed"),
          isNull(memoryEvent.deletedAt),
        ),
      )
      .orderBy(asc(memoryEventTag.tag)),
    db
      .selectDistinct({
        year: sql<number>`cast(strftime('%Y', ${memoryEvent.occurredAt}, 'unixepoch') as integer)`,
      })
      .from(memoryEvent)
      .where(
        and(
          eq(memoryEvent.familyId, familyId),
          eq(memoryEvent.status, "confirmed"),
          isNull(memoryEvent.deletedAt),
        ),
      )
      .orderBy(desc(memoryEvent.occurredAt)),
  ]);
  return {
    tags: tagRows.map((row) => row.tag),
    years: yearRows.map((row) => Number(row.year)).filter(Number.isSafeInteger),
  };
}
