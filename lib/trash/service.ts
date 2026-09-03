import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { contribution as contributionTable, fact as factTable } from "@/db/schema/contribution";
import { memoryEvent, memoryEventAsset } from "@/db/schema/memory";
import { story, storyParagraph } from "@/db/schema/story";
import { asset as assetTable } from "@/db/schema/asset";
import { inboxItemAsset } from "@/db/schema/inbox";
import { capsuleAsset, capsuleReply } from "@/db/schema/capsule";
import { assertFamilyCapability } from "@/lib/authz/policy";
import { recordAudit } from "@/lib/audit/service";
import { getAssetStorage } from "@/lib/assets/storage";
import type { FamilyContext } from "@/lib/family/context";

/**
 * 回收站（M7，PRD §22）：MemoryEvent / Contribution / Story 的
 * 软删除 → 恢复 → 显式清除。
 *
 * - 软删除行在列表/详情/导出/搜索/故事素材中一律不可见（各查询过滤
 *   deletedAt IS NULL）；
 * - 清除是硬删除（行 + 级联链接），需要再次显式确认，写审计；
 * - Asset 永不因清除事件被连带物理删除：原件可能被多个事件/收件箱/胶囊
 *   引用；只有完全无引用时才允许物理删除（purgeAssetIfUnreferenced）。
 */

export type TrashKind = "memory_event" | "contribution" | "story";

export type TrashEntry = {
  kind: TrashKind;
  id: string;
  label: string;
  deletedAt: Date;
};

export type TrashMutation =
  | { ok: true }
  | { ok: false; error: string };

function requireWrite(context: FamilyContext, capability: "event:write" | "story:write" | "contribution:create") {
  assertFamilyCapability(context.role, capability);
}

/** contribution 无 familyId 列：经其事件校验家庭归属。 */
function contributionInFamily(db: ReturnType<typeof getDb>, contributionId: string, familyId: string) {
  const row = db
    .select({ id: contributionTable.id, familyId: memoryEvent.familyId })
    .from(contributionTable)
    .innerJoin(memoryEvent, eq(memoryEvent.id, contributionTable.memoryEventId))
    .where(eq(contributionTable.id, contributionId))
    .limit(1)
    .get();
  return row && row.familyId === familyId ? row : null;
}


// ---- 软删除 ----

export function trashMemoryEvent(context: FamilyContext, eventId: string): TrashMutation {
  try {
    requireWrite(context, "event:write");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const db = getDb();
  const row = db
    .select({ id: memoryEvent.id, title: memoryEvent.title })
    .from(memoryEvent)
    .where(
      and(
        eq(memoryEvent.id, eventId),
        eq(memoryEvent.familyId, context.familyId),
        isNull(memoryEvent.deletedAt),
      ),
    )
    .get();
  if (!row) return { ok: false, error: "not_found" };
  const now = new Date();
  db.update(memoryEvent)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(memoryEvent.id, eventId))
    .run();
  removeFromSearchIndex("memory_event", eventId);
  // 事件删除时其确认事实同步移出索引
  const facts = db
    .select({ id: factTable.id })
    .from(factTable)
    .where(eq(factTable.memoryEventId, eventId))
    .all();
  for (const f of facts) removeFromSearchIndex("fact", f.id);
  return { ok: true };
}

export function trashContribution(context: FamilyContext, contributionId: string): TrashMutation {
  try {
    requireWrite(context, "contribution:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const db = getDb();
  const row = contributionInFamily(db, contributionId, context.familyId);
  if (!row || !isNullDeleted(db, contributionId)) return { ok: false, error: "not_found" };
  const now = new Date();
  db.update(contributionTable)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(contributionTable.id, contributionId))
    .run();
  removeFromSearchIndex("contribution", contributionId);
  return { ok: true };
}

function isNullDeleted(db: ReturnType<typeof getDb>, contributionId: string): boolean {
  const row = db
    .select({ deletedAt: contributionTable.deletedAt })
    .from(contributionTable)
    .where(eq(contributionTable.id, contributionId))
    .get();
  return row?.deletedAt == null;
}

export function trashStory(context: FamilyContext, storyId: string): TrashMutation {
  try {
    requireWrite(context, "story:write");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const db = getDb();
  const row = db
    .select({ id: story.id, status: story.status })
    .from(story)
    .where(
      and(
        eq(story.id, storyId),
        eq(story.familyId, context.familyId),
        isNull(story.deletedAt),
      ),
    )
    .get();
  if (!row) return { ok: false, error: "not_found" };
  const now = new Date();
  db.update(story)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(story.id, storyId))
    .run();
  removeFromSearchIndex("story", storyId);
  return { ok: true };
}

// ---- 恢复 ----

export function restoreFromTrash(context: FamilyContext, kind: TrashKind, id: string): TrashMutation {
  const db = getDb();
  const now = new Date();
  if (kind === "memory_event") {
    try {
      requireWrite(context, "event:write");
    } catch {
      return { ok: false, error: "forbidden" };
    }
    const result = db
      .update(memoryEvent)
      .set({ deletedAt: null, updatedAt: now })
      .where(
        and(
          eq(memoryEvent.id, id),
          eq(memoryEvent.familyId, context.familyId),
        ),
      )
      .run();
    if (result.changes === 0) return { ok: false, error: "not_found" };
    reindexEvent(id);
    return { ok: true };
  }
  if (kind === "contribution") {
    try {
      requireWrite(context, "contribution:create");
    } catch {
      return { ok: false, error: "forbidden" };
    }
    const owned = contributionInFamily(db, id, context.familyId);
    if (!owned) return { ok: false, error: "not_found" };
    db.update(contributionTable)
      .set({ deletedAt: null, updatedAt: now })
      .where(eq(contributionTable.id, id))
      .run();
    const row = db
      .select()
      .from(contributionTable)
      .where(eq(contributionTable.id, id))
      .get();
    const eventRow = db
      .select({ familyId: memoryEvent.familyId })
      .from(memoryEvent)
      .where(eq(memoryEvent.id, row?.memoryEventId ?? ""))
      .get();
    if (row && eventRow) {
      indexContribution({
        id: row.id,
        familyId: eventRow.familyId,
        memoryEventId: row.memoryEventId,
        authorPersonId: row.authorPersonId,
        rawText: row.rawText,
        editedText: row.editedText,
        visibility: row.visibility,
      });
    }
    return { ok: true };
  }
  // story
  try {
    requireWrite(context, "story:write");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const result = db
    .update(story)
    .set({ deletedAt: null, updatedAt: now })
    .where(and(eq(story.id, id), eq(story.familyId, context.familyId)))
    .run();
  if (result.changes === 0) return { ok: false, error: "not_found" };
  const row = db.select().from(story).where(eq(story.id, id)).get();
  if (row && row.status === "published") {
    const body = db
      .select({ text: storyParagraph.text })
      .from(storyParagraph)
      .where(eq(storyParagraph.storyId, id))
      .all()
      .map((p) => p.text)
      .join("\n");
    indexStory({ id: row.id, familyId: row.familyId, title: row.title, bodyText: body });
  }
  return { ok: true };
}

// 静态导入（搜索服务不依赖回收站，无循环）
import {
  indexContribution,
  indexFactIfConfirmed,
  indexMemoryEvent,
  indexStory,
  removeFromSearchIndex,
} from "@/lib/search/service";

function reindexEvent(eventId: string): void {
  const db = getDb();
  const row = db.select().from(memoryEvent).where(eq(memoryEvent.id, eventId)).get();
  if (!row) return;
  indexMemoryEvent({ id: row.id, familyId: row.familyId, title: row.title, childPersonId: row.childPersonId });
  const facts = db
    .select()
    .from(factTable)
    .where(eq(factTable.memoryEventId, eventId))
    .all();
  for (const f of facts) {
    indexFactIfConfirmed({
      id: f.id,
      familyId: row.familyId,
      memoryEventId: eventId,
      statement: f.statement,
      status: f.status,
    });
  }
}

// ---- 清除（硬删除） ----

export function purgeFromTrash(context: FamilyContext, kind: TrashKind, id: string): TrashMutation {
  const db = getDb();
  if (kind === "memory_event") {
    try {
      requireWrite(context, "event:write");
    } catch {
      return { ok: false, error: "forbidden" };
    }
    const row = db
      .select({ id: memoryEvent.id })
      .from(memoryEvent)
      .where(
        and(
          eq(memoryEvent.id, id),
          eq(memoryEvent.familyId, context.familyId),
        ),
      )
      .get();
    if (!row) return { ok: false, error: "not_found" };
    // 事件下的讲述也一并清除（它们依附于事件）
    db.delete(contributionTable).where(eq(contributionTable.memoryEventId, id)).run();
    db.delete(memoryEvent).where(eq(memoryEvent.id, id)).run();
    removeFromSearchIndex("memory_event", id);
    void recordAudit(context.familyId, "memory_event.purged", context.userId, { eventId: id });
    return { ok: true };
  }
  if (kind === "contribution") {
    try {
      requireWrite(context, "contribution:create");
    } catch {
      return { ok: false, error: "forbidden" };
    }
    const owned = contributionInFamily(db, id, context.familyId);
    if (!owned) return { ok: false, error: "not_found" };
    db.delete(contributionTable).where(eq(contributionTable.id, id)).run();
    removeFromSearchIndex("contribution", id);
    return { ok: true };
  }
  try {
    requireWrite(context, "story:write");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const row = db
    .select({ id: story.id })
    .from(story)
    .where(and(eq(story.id, id), eq(story.familyId, context.familyId)))
    .get();
  if (!row) return { ok: false, error: "not_found" };
  db.delete(story).where(eq(story.id, id)).run();
  removeFromSearchIndex("story", id);
  return { ok: true };
}

// ---- 列表 ----

export function listTrash(context: FamilyContext): TrashEntry[] {
  const db = getDb();
  const entries: TrashEntry[] = [];

  const events = db
    .select({ id: memoryEvent.id, title: memoryEvent.title, deletedAt: memoryEvent.deletedAt })
    .from(memoryEvent)
    .where(
      and(
        eq(memoryEvent.familyId, context.familyId),
        sql`${memoryEvent.deletedAt} is not null`,
      ),
    )
    .orderBy(desc(memoryEvent.deletedAt))
    .limit(100)
    .all();
  for (const e of events) {
    if (e.deletedAt) entries.push({ kind: "memory_event", id: e.id, label: e.title, deletedAt: e.deletedAt });
  }

  const contributions = db
    .select({
      id: contributionTable.id,
      text: contributionTable.editedText,
      raw: contributionTable.rawText,
      deletedAt: contributionTable.deletedAt,
    })
    .from(contributionTable)
    .innerJoin(memoryEvent, eq(memoryEvent.id, contributionTable.memoryEventId))
    .where(
      and(
        eq(memoryEvent.familyId, context.familyId),
        sql`${contributionTable.deletedAt} is not null`,
      ),
    )
    .orderBy(desc(contributionTable.deletedAt))
    .limit(100)
    .all();
  for (const c of contributions) {
    if (c.deletedAt) {
      const text = (c.text ?? c.raw ?? "").replace(/\s+/gu, " ").slice(0, 40);
      entries.push({ kind: "contribution", id: c.id, label: `讲述：${text}`, deletedAt: c.deletedAt });
    }
  }

  const stories = db
    .select({ id: story.id, title: story.title, deletedAt: story.deletedAt })
    .from(story)
    .where(
      and(eq(story.familyId, context.familyId), sql`${story.deletedAt} is not null`),
    )
    .orderBy(desc(story.deletedAt))
    .limit(100)
    .all();
  for (const st of stories) {
    if (st.deletedAt) entries.push({ kind: "story", id: st.id, label: st.title, deletedAt: st.deletedAt });
  }

  return entries;
}

// ---- Asset 物理删除守卫 ----

/**
 * 只有完全无引用的素材才允许物理删除（含其衍生物与文件）。
 * 返回 false = 仍被引用（调用方应保持文件）。
 */
export function purgeAssetIfUnreferenced(context: FamilyContext, assetId: string): { ok: true; deleted: boolean } | { ok: false; error: string } {
  try {
    assertFamilyCapability(context.role, "event:write");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const db = getDb();
  const asset = db
    .select()
    .from(assetTable)
    .where(and(eq(assetTable.id, assetId), eq(assetTable.familyId, context.familyId)))
    .get();
  if (!asset) return { ok: false, error: "not_found" };

  const referenced =
    db.select({ id: memoryEventAsset.id }).from(memoryEventAsset).where(eq(memoryEventAsset.assetId, assetId)).limit(1).get() ||
    db.select({ id: inboxItemAsset.id }).from(inboxItemAsset).where(eq(inboxItemAsset.assetId, assetId)).limit(1).get() ||
    db.select({ id: capsuleAsset.id }).from(capsuleAsset).where(eq(capsuleAsset.assetId, assetId)).limit(1).get() ||
    db.select({ id: capsuleReply.id }).from(capsuleReply).where(eq(capsuleReply.assetId, assetId)).limit(1).get() ||
    db
      .select({ id: contributionTable.id })
      .from(contributionTable)
      .where(eq(contributionTable.audioAssetId, assetId))
      .limit(1)
      .get() ||
    // 原件被衍生物指向 / 衍生物指回原件，任一方向都算引用
    db.select({ id: assetTable.id }).from(assetTable).where(eq(assetTable.originalAssetId, assetId)).limit(1).get();
  if (referenced) {
    return { ok: true, deleted: false };
  }

  const storage = getAssetStorage();
  const derivatives = db
    .select()
    .from(assetTable)
    .where(eq(assetTable.originalAssetId, assetId))
    .all();
  for (const derivative of derivatives) {
    try {
      storage.delete(derivative.storageKey);
    } catch {
      // 尽力而为
    }
    db.delete(assetTable).where(eq(assetTable.id, derivative.id)).run();
  }
  try {
    storage.delete(asset.storageKey);
  } catch {
    // 尽力而为
  }
  db.delete(assetTable).where(eq(assetTable.id, assetId)).run();
  return { ok: true, deleted: true };
}

export const TRASH_KINDS: readonly TrashKind[] = ["memory_event", "contribution", "story"];
