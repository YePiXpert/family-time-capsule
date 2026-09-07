import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { draft, draftItem } from "@/db/schema/draft";
import { asset } from "@/db/schema/asset";
import { user } from "@/db/schema/auth";
import { person } from "@/db/schema/family";
import { inboxItem, inboxItemAsset, inboxItemParticipant } from "@/db/schema/inbox";
import { memoryEvent, memoryEventAsset, memoryEventParticipant, memoryEventReader } from "@/db/schema/memory";
import type { FamilyContext } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { createContributionAccessSnapshot, getContributionAssetAccessInTransaction, type ContributionAccessTransaction } from "@/lib/authz/contribution-access";
import { indexMemoryEvent, indexDocumentAssetsForEvent } from "@/lib/search/service";
import { parseDraftContent, type Draft, type DraftContent } from "./model";

export class DraftError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
function assertActor(tx: ContributionAccessTransaction, context: FamilyContext, publish = false) {
  const actor = tx.select().from(user).where(and(eq(user.id, context.userId), eq(user.familyId, context.familyId), isNull(user.disabledAt))).get();
  if (!actor || actor.role !== context.role || actor.personId !== context.personId || !hasFamilyCapability(context.role, publish ? "event:write" : "capture:create")) throw new DraftError("forbidden", 403);
}
function authorship(context: FamilyContext) {
  return or(eq(draft.authorUserId, context.userId), context.personId ? and(isNull(draft.authorUserId), eq(draft.authorPersonId, context.personId)) : undefined);
}
function owned(context: FamilyContext, id: string) {
  return and(eq(draft.id, id), eq(draft.familyId, context.familyId), authorship(context));
}
function hydrate(tx: ContributionAccessTransaction, row: typeof draft.$inferSelect): Draft {
  const items = tx.select().from(draftItem).where(eq(draftItem.draftId, row.id)).orderBy(asc(draftItem.sortOrder)).all();
  let readerUserIds: string[] = [];
  try { readerUserIds = JSON.parse(row.readerUserIdsJson ?? "[]") as string[]; } catch { readerUserIds = []; }
  return { ...parseDraftContent({ ...row, participantIds: JSON.parse(row.participantIdsJson), readerUserIds, items: items.map(item => ({ ...item, ...(!item.assetId && !item.localCaptureRef ? { preservationState: "missing" } : {}) })) }), id: row.id, revision: row.revision, mutationId: row.mutationId, status: row.status as Draft["status"], memoryEventId: row.memoryEventId, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
export function listDrafts(context: FamilyContext): Draft[] {
  return getDb().transaction(tx => {
    assertActor(tx, context);
    return tx.select().from(draft).where(and(eq(draft.familyId, context.familyId), authorship(context), eq(draft.status, "editing"))).orderBy(desc(draft.updatedAt)).all().map(row => hydrate(tx, row));
  });
}
export function getDraft(context: FamilyContext, id: string): Draft {
  return getDb().transaction(tx => {
    assertActor(tx, context);
    const row = tx.select().from(draft).where(owned(context, id)).get();
    if (!row) throw new DraftError("not_found", 404);
    return hydrate(tx, row);
  });
}
function validateReferences(tx: ContributionAccessTransaction, context: FamilyContext, content: DraftContent, draftId: string) {
  const people = content.participantIds.length ? tx.select({ id: person.id }).from(person).where(and(eq(person.familyId, context.familyId), inArray(person.id, content.participantIds))).all() : [];
  if (people.length !== content.participantIds.length) throw new DraftError("invalid_person");
  // §5：指定读者必须是本家庭的在册用户；参与人物不是读者。
  if (content.readerUserIds.length > 0) {
    const readers = tx.select({ id: user.id }).from(user).where(and(eq(user.familyId, context.familyId), inArray(user.id, content.readerUserIds), isNull(user.disabledAt))).all();
    if (readers.length !== new Set(content.readerUserIds).size) throw new DraftError("invalid_reader");
  }
  const snapshot = createContributionAccessSnapshot(context);
  for (const item of content.items) {
    if (item.assetId) {
      const original = tx.select().from(asset).where(and(eq(asset.id, item.assetId), eq(asset.familyId, context.familyId), isNull(asset.originalAssetId))).get();
      if (!original || !getContributionAssetAccessInTransaction(tx, snapshot, item.assetId).readable) throw new DraftError("asset_unavailable", 403);
    }
    const existing = tx.select({ draftId: draftItem.draftId }).from(draftItem).where(eq(draftItem.id, item.id)).get();
    if (existing && existing.draftId !== draftId) throw new DraftError("item_conflict", 409);
  }
}
export function saveDraft(context: FamilyContext, id: string, expectedRevision: number, mutationId: string, value: unknown): Draft {
  let content: DraftContent;
  try { content = parseDraftContent(value); } catch { throw new DraftError("invalid_draft"); }
  if (typeof id !== "string" || typeof mutationId !== "string" || !/^[\w-]{1,128}$/u.test(id) || !/^[\w-]{1,128}$/u.test(mutationId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new DraftError("invalid_draft");
  return getDb().transaction(tx => {
    assertActor(tx, context);
    const current = tx.select().from(draft).where(eq(draft.id, id)).get();
    if (current && (current.familyId !== context.familyId || (current.authorUserId !== context.userId && !(current.authorUserId === null && context.personId && current.authorPersonId === context.personId)))) throw new DraftError("not_found", 404);
    if (current?.mutationId === mutationId) return hydrate(tx, current);
    if (current && current.status !== "editing") throw new DraftError("draft_closed", 409);
    if ((current?.revision ?? 0) !== expectedRevision) throw new DraftError("revision_conflict", 409);
    validateReferences(tx, context, content, id);
    const now = new Date().toISOString();
    const fields = { authorUserId: context.userId, authorPersonId: context.personId, authorName: context.userName, title: content.title, text: content.text, occurredAt: content.occurredAt, occurredAtPrecision: content.occurredAtPrecision, locationText: content.locationText, participantIdsJson: JSON.stringify(content.participantIds), visibility: content.visibility, readerUserIdsJson: JSON.stringify(content.readerUserIds), coverItemId: content.coverItemId, revision: expectedRevision + 1, mutationId, updatedAt: now };
    if (current) tx.update(draft).set(fields).where(owned(context, id)).run();
    else tx.insert(draft).values({ ...fields, id, familyId: context.familyId, authorUserId: context.userId, createdAt: now }).run();
    tx.delete(draftItem).where(eq(draftItem.draftId, id)).run();
    if (current?.inboxItemId) {
      if (content.visibility !== "family") throw new DraftError("already_shared", 409);
      mirrorInbox(tx, context, current.inboxItemId, content);
    }
    for (const [sortOrder, item] of content.items.entries()) tx.insert(draftItem).values({ id: item.id, assetId: item.assetId, localCaptureRef: item.localCaptureRef, caption: item.caption, draftId: id, sortOrder }).run();
    return hydrate(tx, tx.select().from(draft).where(owned(context, id)).get()!);
  }, { behavior: "immediate" });
}
export function discardDraft(context: FamilyContext, id: string, expectedRevision: number): void {
  getDb().transaction(tx => {
    assertActor(tx, context);
    const current = tx.select().from(draft).where(owned(context, id)).get();
    if (!current) throw new DraftError("not_found", 404);
    if (current.status === "discarded") return;
    if (current.status !== "editing" || current.revision !== expectedRevision) throw new DraftError("revision_conflict", 409);
    tx.update(draft).set({ status: "discarded", coverItemId: null, revision: current.revision + 1, updatedAt: new Date().toISOString() }).where(owned(context, id)).run();
    if (current.inboxItemId) tx.update(inboxItem).set({ status: "discarded", updatedAt: new Date() }).where(and(eq(inboxItem.id, current.inboxItemId), eq(inboxItem.familyId, context.familyId))).run();
    // Discarding references must never remove original bytes or intake receipts.
    tx.delete(draftItem).where(eq(draftItem.draftId, id)).run();
  }, { behavior: "immediate" });
}
export function publishDraft(context: FamilyContext, id: string, expectedRevision: number): Draft {
  const published = getDb().transaction(tx => {
    assertActor(tx, context, true);
    const row = tx.select().from(draft).where(owned(context, id)).get();
    if (!row) throw new DraftError("not_found", 404);
    if (row.status === "published") return hydrate(tx, row);
    if (row.status !== "editing" || row.revision !== expectedRevision) throw new DraftError("revision_conflict", 409);
    const content = hydrate(tx, row);
    validateReferences(tx, context, content, id);
    // §5：私密/指定读者草稿现在直接发布为对应可见性的记忆事件；
    // 挂在家庭收件箱上的聚合仍要求 family（收件箱是全家评审面）。
    if (row.inboxItemId && content.visibility !== "family") throw new DraftError("already_shared", 409);
    if (!content.occurredAt) throw new DraftError("occurred_at_required");
    if (!content.text.trim() && !content.items.length) throw new DraftError("empty_draft");
    if (content.items.some(item => !item.assetId)) throw new DraftError("originals_pending", 409);
    const eventId = randomUUID(), now = new Date();
    const title = content.title.trim() || content.text.trim().slice(0, 60) || "一段家庭记忆";
    const coverAssetId = content.items.find(item => item.id === content.coverItemId)?.assetId ?? content.items[0]?.assetId ?? null;
    tx.insert(memoryEvent).values({ id: eventId, familyId: context.familyId, title, titleSource: content.title.trim() ? "manual" : "rule_generated", childPersonId: null, ageDays: null, occurredAt: new Date(content.occurredAt), occurredAtPrecision: content.occurredAtPrecision, locationText: content.locationText || null, coverAssetId, visibility: content.visibility, createdByUserId: context.userId, lastEditedByUserId: context.userId, createdAt: now, updatedAt: now }).run();
    for (const [sortOrder, item] of content.items.entries()) tx.insert(memoryEventAsset).values({ id: randomUUID(), familyId: context.familyId, memoryEventId: eventId, assetId: item.assetId!, sortOrder, caption: item.caption, createdAt: now }).run();
    for (const personId of content.participantIds) tx.insert(memoryEventParticipant).values({ id: randomUUID(), familyId: context.familyId, memoryEventId: eventId, personId, createdAt: now }).run();
    if (content.visibility === "members") {
      for (const userId of content.readerUserIds) tx.insert(memoryEventReader).values({ id: randomUUID(), familyId: context.familyId, memoryEventId: eventId, userId, createdAt: now }).run();
    }
    if (row.inboxItemId) {
      tx.update(inboxItem).set({ status: "confirmed", memoryEventId: eventId, updatedAt: now }).where(eq(inboxItem.id, row.inboxItemId)).run();
    } else if (content.visibility === "family" && content.text.trim()) {
      // 私密事件不进入全家可见的收件箱记录。
      tx.insert(inboxItem).values({ id: randomUUID(), familyId: context.familyId, kind: "text", rawText: content.text, status: "confirmed", memoryEventId: eventId, createdAt: now, updatedAt: now }).run();
    }
    tx.update(draft).set({ status: "published", memoryEventId: eventId, revision: row.revision + 1, updatedAt: now.toISOString() }).where(owned(context, id)).run();
    return hydrate(tx, tx.select().from(draft).where(owned(context, id)).get()!);
  }, { behavior: "immediate" });
  // Derived indexing is retryable. No AI/network operation enters the save transaction.
  if (published.memoryEventId) {
    const event = getDb().select().from(memoryEvent).where(eq(memoryEvent.id, published.memoryEventId)).get();
    if (event) {
      // 非 family 事件没有家庭收件箱聚合，正文随事件一并索引（读取侧有
      // 实时读者裁决，索引本身不构成泄漏面）。
      indexMemoryEvent(published.visibility === "family" ? event : { ...event, text: published.text });
      indexDocumentAssetsForEvent(context.familyId, event.id, published.items.flatMap(i => i.assetId ? [i.assetId] : []));
    }
  }
  return published;
}

function mirrorInbox(tx: ContributionAccessTransaction, context: FamilyContext, inboxId: string, content: DraftContent) {
  const now = new Date();
  tx.update(inboxItem).set({ kind: content.items.length ? "bundle" : "text", rawText: content.text || null, draftTitle: content.title || null, draftOccurredAt: content.occurredAt ? new Date(content.occurredAt) : null, draftLocationText: content.locationText || null, titleSource: content.title ? "manual" : "rule_generated", titleRevision: (tx.select().from(inboxItem).where(eq(inboxItem.id, inboxId)).get()?.titleRevision ?? 0) + 1, updatedAt: now }).where(eq(inboxItem.id, inboxId)).run();
  tx.delete(inboxItemAsset).where(eq(inboxItemAsset.inboxItemId, inboxId)).run();
  tx.delete(inboxItemParticipant).where(eq(inboxItemParticipant.inboxItemId, inboxId)).run();
  for (const item of content.items) {
    if (!item.assetId) throw new DraftError("originals_pending", 409);
    tx.insert(inboxItemAsset).values({ id: randomUUID(), familyId: context.familyId, inboxItemId: inboxId, assetId: item.assetId, createdAt: now }).run();
  }
  for (const personId of content.participantIds) tx.insert(inboxItemParticipant).values({ id: randomUUID(), familyId: context.familyId, inboxItemId: inboxId, personId, createdAt: now }).run();
}
/** Explicitly offer one aggregate for family review; unfinished personal drafts stay private. */
export function submitDraftForReview(context: FamilyContext, id: string, expectedRevision: number): Draft {
  return getDb().transaction(tx => {
    assertActor(tx, context);
    const row = tx.select().from(draft).where(owned(context, id)).get();
    if (!row) throw new DraftError("not_found", 404);
    if (row.status !== "editing" || row.revision !== expectedRevision) throw new DraftError("revision_conflict", 409);
    const content = hydrate(tx, row);
    validateReferences(tx, context, content, id);
    if (content.visibility !== "family") throw new DraftError("private_publication_unavailable", 409);
    if (!content.text.trim() && !content.items.length) throw new DraftError("empty_draft");
    if (!row.inboxItemId) tx.insert(inboxItem).values({ id, familyId: context.familyId, kind: "bundle", status: "needs_review", createdAt: new Date(), updatedAt: new Date() }).run();
    mirrorInbox(tx, context, row.inboxItemId ?? id, content);
    tx.update(draft).set({ inboxItemId: row.inboxItemId ?? id, revision: row.revision + 1, updatedAt: new Date().toISOString() }).where(owned(context, id)).run();
    return hydrate(tx, tx.select().from(draft).where(owned(context, id)).get()!);
  }, { behavior: "immediate" });
}
