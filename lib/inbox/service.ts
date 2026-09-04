import "server-only";

import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { asset as assetTable } from "@/db/schema/asset";
import {
  inboxItem,
  inboxItemAsset,
  inboxItemParticipant,
} from "@/db/schema/inbox";
import { person as personTable } from "@/db/schema/family";
import type { AssetRow } from "@/lib/assets/service";

/**
 * 收件箱领域服务（Issue #007）。
 * 上传的素材先进 Inbox（不直接进 Timeline）；确认动作在 #008。
 */

export type InboxStatus =
  | "new"
  | "processing"
  | "needs_review"
  | "confirmed"
  | "discarded";

export type InboxItemRow = typeof inboxItem.$inferSelect;

export type InboxEntry = {
  item: InboxItemRow;
  assets: AssetRow[];
  participantPersonIds: string[];
};

export type IdempotentAssetCaptureResult =
  | { status: "created" | "existing" | "duplicate"; item: InboxItemRow }
  | { status: "conflict" };

/**
 * Atomically attach a native media outbox UUID to its canonical asset. The
 * same UUID + same bytes is a successful retry; the same UUID + other bytes
 * is a conflict. If SHA deduplication finds an asset already represented by a
 * different inbox item, reuse that item instead of creating duplicate work.
 */
export function createInboxItemForAssetIdempotent(
  familyId: string,
  assetRow: AssetRow,
  itemId: string,
): IdempotentAssetCaptureResult {
  if (assetRow.familyId !== familyId) return { status: "conflict" };
  const db = getDb();
  return db.transaction((tx) => {
    const existingItem = tx
      .select()
      .from(inboxItem)
      .where(eq(inboxItem.id, itemId))
      .limit(1)
      .get();
    if (existingItem) {
      if (existingItem.familyId !== familyId || existingItem.kind !== "asset") {
        return { status: "conflict" };
      }
      const existingLinks = tx
        .select({ assetId: inboxItemAsset.assetId })
        .from(inboxItemAsset)
        .where(eq(inboxItemAsset.inboxItemId, itemId))
        .all();
      if (existingLinks.some((link) => link.assetId === assetRow.id)) {
        return { status: "existing", item: existingItem };
      }
      if (existingLinks.length > 0) return { status: "conflict" };
      const assetLink = tx
        .select({ inboxItemId: inboxItemAsset.inboxItemId })
        .from(inboxItemAsset)
        .where(
          and(
            eq(inboxItemAsset.familyId, familyId),
            eq(inboxItemAsset.assetId, assetRow.id),
          ),
        )
        .limit(1)
        .get();
      if (assetLink) return { status: "conflict" };
      tx.insert(inboxItemAsset)
        .values({
          id: randomUUID(),
          inboxItemId: itemId,
          assetId: assetRow.id,
          familyId,
          createdAt: new Date(),
        })
        .run();
      return { status: "existing", item: existingItem };
    }

    const existingAssetLink = tx
      .select({ inboxItemId: inboxItemAsset.inboxItemId })
      .from(inboxItemAsset)
      .where(
        and(
          eq(inboxItemAsset.familyId, familyId),
          eq(inboxItemAsset.assetId, assetRow.id),
        ),
      )
      .limit(1)
      .get();
    if (existingAssetLink) {
      const represented = tx
        .select()
        .from(inboxItem)
        .where(eq(inboxItem.id, existingAssetLink.inboxItemId))
        .limit(1)
        .get();
      if (represented) return { status: "duplicate", item: represented };
      return { status: "conflict" };
    }

    const now = new Date();
    const item = tx
      .insert(inboxItem)
      .values({
        id: itemId,
        familyId,
        kind: "asset",
        status: assetRow.timeSource === "import_time" ? "needs_review" : "new",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    tx.insert(inboxItemAsset)
      .values({
        id: randomUUID(),
        inboxItemId: itemId,
        assetId: assetRow.id,
        familyId,
        createdAt: now,
      })
      .run();
    return { status: "created", item };
  });
}

/** 上传入箱：asset 无可信时间（import_time）时标 needs_review（「缺少时间」） */
export async function createInboxItemForAsset(
  familyId: string,
  assetRow: AssetRow,
): Promise<InboxItemRow> {
  const db = getDb();
  return db.transaction((tx) => {
    const itemId = randomUUID();
    const now = new Date();
    const item = tx
      .insert(inboxItem)
      .values({
        id: itemId,
        familyId,
        kind: "asset",
        status: assetRow.timeSource === "import_time" ? "needs_review" : "new",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    tx.insert(inboxItemAsset)
      .values({
        id: randomUUID(),
        inboxItemId: itemId,
        assetId: assetRow.id,
        familyId,
        createdAt: now,
      })
      .run();
    return item;
  });
}

/** 文本入箱（#011 使用；kind=text 不关联 asset） */
export async function createTextInboxItem(
  familyId: string,
  rawText: string,
): Promise<InboxItemRow> {
  const db = getDb();
  const now = new Date();
  const rows = await db
    .insert(inboxItem)
    .values({
      id: randomUUID(),
      familyId,
      kind: "text",
      status: "new",
      rawText,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return rows[0];
}

export type IdempotentTextCaptureResult =
  | { status: "created" | "existing"; item: InboxItemRow }
  | { status: "conflict" };

/**
 * Native offline outbox entry point. The device generates the inbox id before
 * it goes offline, so retrying after an ambiguous network failure cannot
 * create duplicate family memories.
 */
export async function createTextInboxItemIdempotent(
  familyId: string,
  rawText: string,
  itemId: string,
): Promise<IdempotentTextCaptureResult> {
  const db = getDb();
  const now = new Date();
  const inserted = await db
    .insert(inboxItem)
    .values({
      id: itemId,
      familyId,
      kind: "text",
      status: "new",
      rawText,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: inboxItem.id })
    .returning();
  if (inserted[0]) return { status: "created", item: inserted[0] };

  const existing = await db
    .select()
    .from(inboxItem)
    .where(and(eq(inboxItem.familyId, familyId), eq(inboxItem.id, itemId)))
    .limit(1);
  if (
    existing[0]?.kind === "text" &&
    existing[0].rawText === rawText
  ) {
    return { status: "existing", item: existing[0] };
  }
  return { status: "conflict" };
}

export type InboxPage = {
  entries: InboxEntry[];
  nextCursor: string | null;
};

const INBOX_PAGE_SIZE_DEFAULT = 50;
const INBOX_PAGE_SIZE_MAX = 200;

function decodeInboxCursor(cursor: string | null | undefined): {
  createdAtMs: number;
  itemId: string;
} | null {
  if (!cursor) return null;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      createdAtMs?: unknown;
      itemId?: unknown;
    };
    if (
      typeof decoded.createdAtMs !== "number" ||
      typeof decoded.itemId !== "string"
    ) {
      return null;
    }
    return { createdAtMs: decoded.createdAtMs, itemId: decoded.itemId };
  } catch {
    return null;
  }
}

function encodeInboxCursor(item: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ createdAtMs: item.createdAt.getTime(), itemId: item.id }),
    "utf8",
  ).toString("base64url");
}

/**
 * 收件箱分页（M7）：keyset（createdAt DESC, id DESC）。
 * 不传 cursor 时等价于旧行为的第一页；兼容 listInbox 的全量语义的调用方
 * （聚类/搜索重建）继续走 listInbox。
 */
export async function getInboxPage(
  familyId: string,
  statuses: InboxStatus[] = ["new", "needs_review", "processing"],
  options: { cursor?: string | null; limit?: number } = {},
): Promise<InboxPage> {
  const db = getDb();
  const limit = Math.min(
    Math.max(options.limit ?? INBOX_PAGE_SIZE_DEFAULT, 1),
    INBOX_PAGE_SIZE_MAX,
  );
  const cursor = decodeInboxCursor(options.cursor);
  const cursorFilter = cursor
    ? sql`(${inboxItem.createdAt}, ${inboxItem.id}) < (${Math.floor(cursor.createdAtMs / 1000)}, ${cursor.itemId})`
    : undefined;
  const items = await db
    .select()
    .from(inboxItem)
    .where(
      and(
        eq(inboxItem.familyId, familyId),
        inArray(inboxItem.status, statuses),
        cursorFilter,
      ),
    )
    .orderBy(desc(inboxItem.createdAt), desc(inboxItem.id))
    .limit(limit + 1);

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? encodeInboxCursor(page[page.length - 1]) : null;
  const entries = await assembleInboxEntries(db, familyId, page);
  return { entries, nextCursor };
}

/**
 * 全量开放条目（聚类/测试用）。分页 UI 请用 getInboxPage。
 * 上限 500：超过时最旧的条目不再返回（聚类扫描本身也有上限）。
 */
export async function listInbox(
  familyId: string,
  statuses: InboxStatus[] = ["new", "needs_review", "processing"],
): Promise<InboxEntry[]> {
  const db = getDb();
  const items = await db
    .select()
    .from(inboxItem)
    .where(
      and(
        eq(inboxItem.familyId, familyId),
        inArray(inboxItem.status, statuses),
      ),
    )
    .orderBy(desc(inboxItem.createdAt), desc(inboxItem.id))
    .limit(500);
  return assembleInboxEntries(db, familyId, items);
}

async function assembleInboxEntries(
  db: ReturnType<typeof getDb>,
  familyId: string,
  items: InboxItemRow[],
): Promise<InboxEntry[]> {
  if (items.length === 0) return [];
  const links = await db
    .select()
    .from(inboxItemAsset)
    .where(
      inArray(
        inboxItemAsset.inboxItemId,
        items.map((i) => i.id),
      ),
    );
  const assetIds = [...new Set(links.map((l) => l.assetId))];
  const assets =
    assetIds.length > 0
      ? await db.select().from(assetTable).where(inArray(assetTable.id, assetIds))
      : [];
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const participantLinks = await db
    .select({ inboxItemId: inboxItemParticipant.inboxItemId, personId: inboxItemParticipant.personId })
    .from(inboxItemParticipant)
    .where(
      and(
        eq(inboxItemParticipant.familyId, familyId),
        inArray(inboxItemParticipant.inboxItemId, items.map((item) => item.id)),
      ),
    );
  return items.map((item) => ({
    item,
    assets: links
      .filter((l) => l.inboxItemId === item.id)
      .map((l) => assetById.get(l.assetId))
      .filter((a): a is AssetRow => Boolean(a)),
    participantPersonIds: participantLinks
      .filter((link) => link.inboxItemId === item.id)
      .map((link) => link.personId),
  }));
}

export async function getInboxEntry(
  familyId: string,
  itemId: string,
): Promise<InboxEntry | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(inboxItem)
    .where(and(eq(inboxItem.familyId, familyId), eq(inboxItem.id, itemId)))
    .limit(1);
  if (!rows[0]) return undefined;
  const links = await db
    .select()
    .from(inboxItemAsset)
    .where(eq(inboxItemAsset.inboxItemId, itemId));
  const assets =
    links.length > 0
      ? await db
          .select()
          .from(assetTable)
          .where(
            inArray(
              assetTable.id,
              links.map((l) => l.assetId),
            ),
          )
      : [];
  const participantLinks = await db
    .select({ personId: inboxItemParticipant.personId })
    .from(inboxItemParticipant)
    .where(
      and(
        eq(inboxItemParticipant.familyId, familyId),
        eq(inboxItemParticipant.inboxItemId, itemId),
      ),
    );
  return {
    item: rows[0],
    assets,
    participantPersonIds: participantLinks.map((link) => link.personId),
  };
}

export type InboxDraftPatch = {
  title?: string | null;
  occurredAt?: Date | null;
  locationText?: string | null;
  participantPersonIds?: string[];
};

export async function updateInboxDraft(
  familyId: string,
  itemId: string,
  patch: InboxDraftPatch,
): Promise<InboxEntry | undefined> {
  const db = getDb();
  const entry = await getInboxEntry(familyId, itemId);
  if (!entry || !["new", "needs_review", "processing"].includes(entry.item.status)) {
    return undefined;
  }
  const title = patch.title === undefined ? entry.item.draftTitle : patch.title?.trim() || null;
  const locationText = patch.locationText === undefined
    ? entry.item.draftLocationText
    : patch.locationText?.trim().slice(0, 200) || null;
  if (title && title.length > 100) return undefined;
  if (patch.occurredAt && Number.isNaN(patch.occurredAt.getTime())) return undefined;
  const participantIds = patch.participantPersonIds === undefined
    ? entry.participantPersonIds
    : [...new Set(patch.participantPersonIds)];
  if (participantIds.length > 50) return undefined;
  if (participantIds.length > 0) {
    const valid = await db
      .select({ id: personTable.id })
      .from(personTable)
      .where(and(eq(personTable.familyId, familyId), inArray(personTable.id, participantIds)));
    if (valid.length !== participantIds.length) return undefined;
  }
  const now = new Date();
  db.transaction((tx) => {
    tx.update(inboxItem)
      .set({
        draftTitle: title,
        draftOccurredAt: patch.occurredAt === undefined ? entry.item.draftOccurredAt : patch.occurredAt,
        draftLocationText: locationText,
        updatedAt: now,
      })
      .where(and(eq(inboxItem.familyId, familyId), eq(inboxItem.id, itemId)))
      .run();
    if (patch.participantPersonIds !== undefined) {
      tx.delete(inboxItemParticipant)
        .where(and(eq(inboxItemParticipant.familyId, familyId), eq(inboxItemParticipant.inboxItemId, itemId)))
        .run();
      if (participantIds.length > 0) {
        tx.insert(inboxItemParticipant)
          .values(participantIds.map((personId) => ({
            id: randomUUID(),
            inboxItemId: itemId,
            personId,
            familyId,
            createdAt: now,
          })))
          .run();
      }
    }
  });
  return getInboxEntry(familyId, itemId);
}

/** 收件箱内修正时间：委托 Asset 更新（user_confirmed），条目状态转 new */
export async function setInboxItemAssetTime(
  familyId: string,
  itemId: string,
  capturedAt: Date,
): Promise<boolean> {
  const { updateAssetCapturedAt } = await import("@/lib/assets/ingest");
  const entry = await getInboxEntry(familyId, itemId);
  if (!entry || entry.assets.length === 0) return false;
  const db = getDb();
  for (const a of entry.assets) {
    await updateAssetCapturedAt(familyId, a.id, capturedAt);
  }
  await db
    .update(inboxItem)
    .set({ status: "new", updatedAt: new Date() })
    .where(and(eq(inboxItem.familyId, familyId), eq(inboxItem.id, itemId)));
  return true;
}

/** 废弃：条目 discarded；Asset 永远保留（原件不是收件箱的私有物） */
export async function discardInboxItem(
  familyId: string,
  itemId: string,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(inboxItem)
    .set({ status: "discarded", updatedAt: new Date() })
    .where(and(eq(inboxItem.familyId, familyId), eq(inboxItem.id, itemId)))
    .returning();
  return rows.length > 0;
}

export async function countInbox(familyId: string): Promise<number> {
  const row = await getDb()
    .select({ value: count() })
    .from(inboxItem)
    .where(
      and(
        eq(inboxItem.familyId, familyId),
        inArray(inboxItem.status, ["new", "needs_review", "processing"]),
      ),
    );
  return Number(row[0]?.value ?? 0);
}
