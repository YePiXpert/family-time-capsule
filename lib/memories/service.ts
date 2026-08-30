import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { asset as assetTable } from "@/db/schema/asset";
import { person as personTable } from "@/db/schema/family";
import { inboxItem } from "@/db/schema/inbox";
import {
  memoryEvent,
  memoryEventAsset,
  memoryEventParticipant,
} from "@/db/schema/memory";
import type { AssetRow } from "@/lib/assets/service";
import { getInboxEntry, type InboxEntry } from "@/lib/inbox/service";

/**
 * MemoryEvent 领域服务（Issue #008）。
 * 确认收件箱条目 → 创建事件；occurredAt 默认取 Asset capturedAt（不是 importedAt）。
 */

export type MemoryEventRow = typeof memoryEvent.$inferSelect;
export type PersonRow = typeof personTable.$inferSelect;

export type MemoryEventDetail = {
  event: MemoryEventRow;
  assets: AssetRow[];
  participants: PersonRow[];
};

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
  const childPersonId = await getChildPersonId(familyId);
  if (!childPersonId) return { ok: false, error: "no_child" };

  const title = (opts.title ?? defaultTitle(entry)).trim();
  if (title.length < 1 || title.length > 100) return { ok: false, error: "invalid" };

  const occurredAt = opts.occurredAt ?? defaultOccurredAt(entry.assets, entry.item);
  const precision = opts.occurredAtPrecision ?? "exact";

  const db = getDb();
  const eventId = randomUUID();
  const now = new Date();

  // 参与人默认：孩子本人
  const participantIds = new Set<string>([childPersonId]);
  for (const pid of opts.participantPersonIds ?? []) participantIds.add(pid);
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
        locationText: null,
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
      .set({ status: "confirmed", updatedAt: now })
      .where(eq(inboxItem.id, entry.item.id))
      .run();
  });

  return { ok: true, eventId };
}

export type MergeOptions = {
  title: string;
  occurredAt?: Date;
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

  db.transaction((tx) => {
    tx.insert(memoryEvent)
      .values({
        id: eventId,
        familyId,
        childPersonId,
        title,
        occurredAt,
        occurredAtPrecision: "exact",
        locationText: null,
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
      .values({
        id: randomUUID(),
        memoryEventId: eventId,
        personId: childPersonId,
        familyId,
        createdAt: now,
      })
      .run();
    // 涉及的全部条目都确认掉
    tx.update(inboxItem)
      .set({ status: "confirmed", updatedAt: now })
      .where(
        and(
          eq(inboxItem.familyId, familyId),
          inArray(inboxItem.id, itemIds),
        ),
      )
      .run();
  });

  return { ok: true, eventId };
}

export async function getMemoryEventDetail(  familyId: string,
  eventId: string,
): Promise<MemoryEventDetail | undefined> {
  const db = getDb();
  const events = await db
    .select()
    .from(memoryEvent)
    .where(and(eq(memoryEvent.familyId, familyId), eq(memoryEvent.id, eventId)))
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

  return { event: events[0], assets, participants };
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
      and(eq(memoryEvent.familyId, familyId), eq(memoryEvent.status, "confirmed")),
    )
    .orderBy(desc(memoryEvent.occurredAt))
    .limit(limit);
}

export type TimelineEntry = {
  event: MemoryEventRow;
  coverAssetId: string | null;
  coverAssetType: string | null;
  coverAssetMime: string | null;
  assetCount: number;
  participantNames: string[];
};

/** 时间轴装配：按 occurredAt 倒序的事件 + 封面 + 素材数 + 参与人（#009） */
export async function getTimeline(
  familyId: string,
): Promise<TimelineEntry[]> {
  const db = getDb();
  const events = await listMemoryEvents(familyId);
  if (events.length === 0) return [];
  const eventIds = events.map((e) => e.id);

  const assetLinks = await db
    .select({
      memoryEventId: memoryEventAsset.memoryEventId,
      assetId: memoryEventAsset.assetId,
      type: assetTable.type,
      mimeType: assetTable.mimeType,
    })
    .from(memoryEventAsset)
    .innerJoin(assetTable, eq(memoryEventAsset.assetId, assetTable.id))
    .where(inArray(memoryEventAsset.memoryEventId, eventIds));
  const coverAssetIds = events
    .map((e) => e.coverAssetId)
    .filter((id): id is string => id !== null);
  const coverAssets =
    coverAssetIds.length > 0
      ? await db
          .select({ id: assetTable.id, type: assetTable.type, mimeType: assetTable.mimeType })
          .from(assetTable)
          .where(inArray(assetTable.id, coverAssetIds))
      : [];
  const coverTypeById = new Map(coverAssets.map((a) => [a.id, a.type]));
  const coverMimeById = new Map(coverAssets.map((a) => [a.id, a.mimeType]));

  const participantLinks = await db
    .select({
      memoryEventId: memoryEventParticipant.memoryEventId,
      personId: memoryEventParticipant.personId,
    })
    .from(memoryEventParticipant)
    .where(inArray(memoryEventParticipant.memoryEventId, eventIds));
  const personIds = [...new Set(participantLinks.map((l) => l.personId))];
  const people =
    personIds.length > 0
      ? await db
          .select({ id: personTable.id, displayName: personTable.displayName })
          .from(personTable)
          .where(inArray(personTable.id, personIds))
      : [];
  const nameById = new Map(people.map((p) => [p.id, p.displayName]));

  return events.map((event) => {
    const links = assetLinks.filter((l) => l.memoryEventId === event.id);
    const fallbackImage = links.find((l) => l.type === "image");
    const coverId = event.coverAssetId ?? fallbackImage?.assetId ?? null;
    const cover =
      (event.coverAssetId && coverTypeById.get(event.coverAssetId)) ??
      fallbackImage?.type ??
      links[0]?.type ??
      null;
    return {
      event,
      coverAssetId: coverId,
      coverAssetType: cover,
      coverAssetMime:
        (coverId && coverMimeById.get(coverId)) ??
        (coverId ? links.find((l) => l.assetId === coverId)?.mimeType : null) ??
        null,
      assetCount: links.length,
      participantNames: participantLinks
        .filter((l) => l.memoryEventId === event.id)
        .map((l) => nameById.get(l.personId))
        .filter((n): n is string => Boolean(n)),
    };
  });
}
