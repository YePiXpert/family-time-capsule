import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { user } from "@/db/schema/auth";
import { auditLog } from "@/db/schema/audit";
import { contribution as contributionTable, fact as factTable } from "@/db/schema/contribution";
import { memoryEvent } from "@/db/schema/memory";
import { story, storyParagraph } from "@/db/schema/story";
import { requiredAuditValues } from "@/lib/audit/service";
import { canEditContribution, hasFamilyCapability, type FamilyCapability } from "@/lib/authz/policy";
import { canManageEventVisibilityInTransaction, createEventAccessSnapshot, eventVisibilityCondition } from "@/lib/authz/event-access";
import { createContributionAccessSnapshot, getVisibleContributionInTransaction, type ContributionAccessTransaction } from "@/lib/authz/contribution-access";
import { familyStoryPredicate } from "@/lib/authz/story-access";
import { deleteLibraryAsset } from "@/lib/assets/deletion";
import { AssetLibraryError } from "@/lib/assets/library";
import { indexContribution, indexFactIfConfirmed, indexMemoryEvent, indexStory, removeFromSearchIndex } from "@/lib/search/service";
import type { FamilyContext } from "@/lib/family/context";

export type TrashKind = "memory_event" | "contribution" | "story";
export type TrashEntry = { kind: TrashKind; id: string; label: string; deletedAt: Date };
export type TrashMutation = { ok: true } | { ok: false; error: string };
type Tx = ContributionAccessTransaction;
const missing = { ok: false, error: "not_found" } as const;
function liveActor(tx: Tx, context: FamilyContext, capability: FamilyCapability) {
  return context.accountEnabled && hasFamilyCapability(context.role, capability) && Boolean(tx.select({ id: user.id }).from(user).where(sql`${user.id}=${context.userId} and ${user.familyId}=${context.familyId} and ${user.role}=${context.role} and ${user.disabledAt} is null`).get());
}
function write(context: FamilyContext, capability: FamilyCapability, mutate: (tx: Tx) => TrashMutation): TrashMutation {
  if (!hasFamilyCapability(context.role, capability)) return { ok: false, error: "forbidden" };
  return getDb().transaction(tx => liveActor(tx, context, capability) ? mutate(tx) : missing, { behavior: "immediate" });
}
function managedEvent(tx: Tx, context: FamilyContext, id: string) {
  if (!canManageEventVisibilityInTransaction(tx, createEventAccessSnapshot(context), id, { includeDeleted: true })) return undefined;
  return tx.select().from(memoryEvent).where(eq(memoryEvent.id, id)).get();
}
function managedContribution(tx: Tx, context: FamilyContext, id: string) {
  const row = getVisibleContributionInTransaction(tx, createContributionAccessSnapshot(context), id, { includeDeleted: true, includeDeletedEvent: true });
  if (!row || !canEditContribution({ role: context.role, accountEnabled: context.accountEnabled, userPersonId: context.personId, authorPersonId: row.authorPersonId, isGuardian: context.isGuardian, childLaterUnlocked: false })) return undefined;
  return tx.select().from(contributionTable).where(eq(contributionTable.id, id)).get();
}
function managedStory(tx: Tx, context: FamilyContext, id: string) {
  return tx.select().from(story).where(and(eq(story.id, id), eq(story.familyId, context.familyId), familyStoryPredicate(context.familyId, sql`${story.id}`))).get();
}
function removeEventIndex(tx: Tx, id: string) {
  removeFromSearchIndex("memory_event", id);
  for (const row of tx.select({ id: factTable.id }).from(factTable).where(eq(factTable.memoryEventId, id)).all()) removeFromSearchIndex("fact", row.id);
}
export function trashMemoryEvent(context: FamilyContext, id: string): TrashMutation {
  return write(context, "event:write", tx => {
    const row = managedEvent(tx, context, id);
    if (!row || row.deletedAt) return missing;
    tx.update(memoryEvent).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(memoryEvent.id, id)).run();
    removeEventIndex(tx, id);
    return { ok: true };
  });
}
export function trashContribution(context: FamilyContext, id: string): TrashMutation {
  return write(context, "contribution:create", tx => {
    const row = managedContribution(tx, context, id);
    if (!row || row.deletedAt) return missing;
    tx.update(contributionTable).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(contributionTable.id, id)).run();
    removeFromSearchIndex("contribution", id);
    return { ok: true };
  });
}
export function trashStory(context: FamilyContext, id: string): TrashMutation {
  return write(context, "story:write", tx => {
    const row = managedStory(tx, context, id);
    if (!row || row.deletedAt) return missing;
    tx.update(story).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(story.id, id)).run();
    removeFromSearchIndex("story", id);
    return { ok: true };
  });
}
export function restoreFromTrash(context: FamilyContext, kind: TrashKind, id: string): TrashMutation {
  return write(context, kind === "memory_event" ? "event:write" : kind === "contribution" ? "contribution:create" : "story:write", tx => {
    if (kind === "memory_event") {
      const row = managedEvent(tx, context, id);
      if (!row?.deletedAt) return missing;
      tx.update(memoryEvent).set({ deletedAt: null, updatedAt: new Date() }).where(eq(memoryEvent.id, id)).run();
      reindexEvent(id);
    } else if (kind === "contribution") {
      const row = managedContribution(tx, context, id);
      if (!row?.deletedAt) return missing;
      tx.update(contributionTable).set({ deletedAt: null, updatedAt: new Date() }).where(eq(contributionTable.id, id)).run();
      indexContribution({ ...row, familyId: context.familyId });
    } else if (kind === "story") {
      const row = managedStory(tx, context, id);
      if (!row?.deletedAt) return missing;
      tx.update(story).set({ deletedAt: null, updatedAt: new Date() }).where(eq(story.id, id)).run();
      if (row.status === "published") {
        const text = tx.select({ text: storyParagraph.text }).from(storyParagraph).where(eq(storyParagraph.storyId, id)).all().map(p => p.text).join("\n");
        indexStory({ id, familyId: context.familyId, title: row.title, bodyText: text });
      }
    } else return missing;
    return { ok: true };
  });
}
export function purgeFromTrash(context: FamilyContext, kind: TrashKind, id: string): TrashMutation {
  return write(context, kind === "memory_event" ? "event:write" : kind === "contribution" ? "contribution:create" : "story:write", tx => {
    if (kind === "memory_event") {
      if (!managedEvent(tx, context, id)?.deletedAt) return missing;
      const children = tx.select({ id: contributionTable.id }).from(contributionTable).where(eq(contributionTable.memoryEventId, id)).all();
      if (children.some(row => !managedContribution(tx, context, row.id))) return { ok: false, error: "other_authors_content" };
      removeEventIndex(tx, id);
      for (const row of children) removeFromSearchIndex("contribution", row.id);
      tx.delete(contributionTable).where(eq(contributionTable.memoryEventId, id)).run();
      tx.delete(memoryEvent).where(eq(memoryEvent.id, id)).run();
    } else if (kind === "contribution") {
      if (!managedContribution(tx, context, id)?.deletedAt) return missing;
      tx.delete(contributionTable).where(eq(contributionTable.id, id)).run();
      removeFromSearchIndex("contribution", id);
    } else if (kind === "story") {
      if (!managedStory(tx, context, id)?.deletedAt) return missing;
      tx.delete(story).where(eq(story.id, id)).run();
      removeFromSearchIndex("story", id);
    } else return missing;
    tx.insert(auditLog).values(requiredAuditValues(context.familyId, `${kind}.purged`, context.userId, kind === "memory_event" ? { eventId: id } : { id })).run();
    return { ok: true };
  });
}
export function listTrash(context: FamilyContext): TrashEntry[] {
  return getDb().transaction(tx => {
    if (!liveActor(tx, context, "archive:view")) return [];
    const entries: TrashEntry[] = [];
    const visibleEvent = eventVisibilityCondition(createEventAccessSnapshot(context));
    const eventManager = hasFamilyCapability(context.role, "event:write") ? sql`(${memoryEvent.visibility}='family' or ${memoryEvent.createdByUserId}=${context.userId})` : sql`0`;
    const ownWords = context.personId && hasFamilyCapability(context.role, "contribution:create") ? eq(contributionTable.authorPersonId, context.personId) : sql`0`;
    for (const row of tx.select().from(memoryEvent).where(and(eq(memoryEvent.familyId, context.familyId), visibleEvent, eventManager, sql`${memoryEvent.deletedAt} is not null`)).orderBy(desc(memoryEvent.deletedAt)).limit(100).all()) {
      if (row.deletedAt && managedEvent(tx, context, row.id)) entries.push({ kind: "memory_event", id: row.id, label: row.title, deletedAt: row.deletedAt });
    }
    const contributions = tx.select({ row: contributionTable }).from(contributionTable).innerJoin(memoryEvent, eq(memoryEvent.id, contributionTable.memoryEventId)).where(and(eq(memoryEvent.familyId, context.familyId), visibleEvent, ownWords, sql`${contributionTable.deletedAt} is not null`)).orderBy(desc(contributionTable.deletedAt)).limit(100).all();
    for (const { row } of contributions) {
      if (row.deletedAt && managedContribution(tx, context, row.id)) entries.push({ kind: "contribution", id: row.id, label: `讲述：${(row.editedText ?? row.rawText ?? "").replace(/\s+/gu, " ").slice(0, 40)}`, deletedAt: row.deletedAt });
    }
    for (const row of tx.select().from(story).where(and(eq(story.familyId, context.familyId), familyStoryPredicate(context.familyId, sql`${story.id}`), sql`${story.deletedAt} is not null`)).orderBy(desc(story.deletedAt)).limit(100).all()) {
      if (row.deletedAt && hasFamilyCapability(context.role, "story:write")) entries.push({ kind: "story", id: row.id, label: row.title, deletedAt: row.deletedAt });
    }
    return entries;
  });
}

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


export function purgeAssetIfUnreferenced(context: FamilyContext, assetId: string): { ok: true; deleted: boolean } | { ok: false; error: string } {
  try {
    const result = deleteLibraryAsset(context, assetId, true);
    return result.cleanupPending ? { ok: false, error: "storage_cleanup_pending" } : { ok: true, deleted: true };
  } catch (error) {
    if (error instanceof AssetLibraryError) return error.code === "asset_in_use" ? { ok: true, deleted: false } : { ok: false, error: error.code };
    throw error;
  }
}

export const TRASH_KINDS: readonly TrashKind[] = ["memory_event", "contribution", "story"];
