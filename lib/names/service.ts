import { assetNameEvidence } from "@/lib/ai/asset-name-evidence";
import { draft } from "@/db/schema/draft";
import "server-only";
import { randomUUID } from "node:crypto";
import { sql, and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { asset } from "@/db/schema/asset";
import { user } from "@/db/schema/auth";
import { inboxItem } from "@/db/schema/inbox";
import { memoryEvent, memoryEventParticipant, memoryEventRevision } from "@/db/schema/memory";
import { aiJob } from "@/db/schema/ai-job";
import { aiSuggestion } from "@/db/schema/suggestion";
import { hasFamilyCapability, isFamilyRole, isEventVisibility, canManageEventVisibility } from "@/lib/authz/policy";
import { canManageOriginalInTransaction } from "@/lib/authz/asset-management";
import { eventVisibilityCondition } from "@/lib/authz/event-access";
import { familyLocalDate, getLiveFamilyPrincipal, type LiveFamilyPrincipal } from "@/lib/authz/principal";
import { getContributionAssetAccessInTransaction, type ContributionAccessTransaction } from "@/lib/authz/contribution-access";
import { indexMemoryEvent } from "@/lib/search/service";
import { completedAiResultIsCurrent } from "@/lib/ai/jobs/service";
import { nameSource } from "@/lib/naming";
import { inboxEvidenceFingerprint } from "@/lib/ai/inbox-evidence";
import { eventEvidenceFingerprint } from "@/lib/ai/event-evidence";

export type NameTargetKind = "asset" | "inbox_item" | "memory_event";
export type NameReviewResult = { ok: true; targetKind: NameTargetKind; targetId: string; revision: number; suggestionRevision?: number }
  | { ok: false; error: "forbidden" | "not_found" | "invalid_input" | "conflict" | "stale_suggestion" | "private_context" | "already_resolved" };
type Tx = ContributionAccessTransaction;
type Target = { kind: NameTargetKind; id: string; text: string | null; source: string; revision: number };

function actorAllowed(tx: Tx, principal: LiveFamilyPrincipal): boolean {
  const actor = tx.select().from(user).where(and(eq(user.id, principal.userId), eq(user.familyId, principal.familyId), isNull(user.disabledAt))).get();
  return Boolean(actor && isFamilyRole(actor.role) && hasFamilyCapability(actor.role, "event:write"));
}

function targetInTransaction(tx: Tx, principal: LiveFamilyPrincipal, kind: NameTargetKind, id: string): Target | null {
  if (kind === "memory_event") {
    const row = tx.select().from(memoryEvent).where(and(eq(memoryEvent.id, id), eq(memoryEvent.familyId, principal.familyId), isNull(memoryEvent.deletedAt), eventVisibilityCondition({ principal, evaluatedAt: new Date() }))).get();
    if (!row || !isEventVisibility(row.visibility) || !canManageEventVisibility(row.visibility, row.createdByUserId, principal)) return null;
    return row ? { kind, id, text: row.title, source: row.titleSource, revision: row.titleRevision } : null;
  }
  if (kind === "inbox_item") {
    const row = tx.select().from(inboxItem).where(and(eq(inboxItem.id, id), eq(inboxItem.familyId, principal.familyId))).get();
    if (!row || !["new", "processing", "needs_review"].includes(row.status)) return null;
    return { kind, id, text: row.draftTitle, source: row.titleSource, revision: row.titleRevision };
  }
  const now = new Date();
  const access = getContributionAssetAccessInTransaction(tx, { principal, evaluatedAt: now, familyLocalDate: familyLocalDate(now, principal.familyTimezone) }, id);
  if (!access.readable) return null;
  const row = tx.select().from(asset).where(and(eq(asset.id, id), eq(asset.familyId, principal.familyId), isNull(asset.originalAssetId))).get();
  if (!row || !canManageOriginalInTransaction(tx, principal, row)) return null;
  return row ? { kind, id, text: row.displayName, source: row.nameSource, revision: row.nameRevision } : null;
}

function setTargetName(tx: Tx, principal: LiveFamilyPrincipal, target: Target, text: string | null, source: string): number {
  const revision = target.revision + 1;
  const now = new Date();
  if (target.kind === "asset") {
    // Only presentation fields: original filename/key/hash/bytes/time never change.
    tx.update(asset).set({ displayName: text, nameSource: source, nameRevision: revision }).where(and(eq(asset.id, target.id), eq(asset.familyId, principal.familyId), eq(asset.nameRevision, target.revision))).run();
  } else if (target.kind === "inbox_item") {
    tx.update(inboxItem).set({ draftTitle: text, titleSource: source, titleRevision: revision, updatedAt: now }).where(and(eq(inboxItem.id, target.id), eq(inboxItem.familyId, principal.familyId), eq(inboxItem.titleRevision, target.revision))).run();
    tx.update(draft).set({ title: text ?? "", revision: sql`${draft.revision} + 1`, mutationId: randomUUID(), updatedAt: now.toISOString() }).where(and(eq(draft.familyId, principal.familyId), eq(draft.inboxItemId, target.id), eq(draft.status, "editing"))).run();
  } else {
    const event = tx.select().from(memoryEvent).where(eq(memoryEvent.id, target.id)).get()!;
    const participants = tx.select({ id: memoryEventParticipant.personId }).from(memoryEventParticipant).where(eq(memoryEventParticipant.memoryEventId, target.id)).all();
    tx.insert(memoryEventRevision).values({ id: randomUUID(), familyId: principal.familyId, memoryEventId: target.id, editedByUserId: principal.userId, snapshotJson: JSON.stringify({ ...event, occurredAt: event.occurredAt.toISOString(), participantPersonIds: participants.map(row => row.id) }), createdAt: now }).run();
    tx.update(memoryEvent).set({ title: text!, titleSource: source, titleRevision: revision, lastEditedByUserId: principal.userId, updatedAt: now }).where(and(eq(memoryEvent.id, target.id), eq(memoryEvent.familyId, principal.familyId), eq(memoryEvent.titleRevision, target.revision))).run();
    // Same SQLite connection: the search update participates in this transaction.
    indexMemoryEvent({ id: target.id, familyId: principal.familyId, title: text!, childPersonId: event.childPersonId });
  }
  return revision;
}

async function principalForNames(familyId: string, userId: string): Promise<LiveFamilyPrincipal | null> {
  try {
    const principal = await getLiveFamilyPrincipal(userId, familyId);
    return hasFamilyCapability(principal.role, "event:write") ? principal : null;
  } catch { return null; }
}

function validRevision(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function validName(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 100 && !/[\u0000-\u001f\u007f]/u.test(value); }

function jobTargetsName(tx: Tx, job: typeof aiJob.$inferSelect, kind: NameTargetKind, id: string, fingerprint: string | null): boolean {
  if (job.jobType === "suggest.asset_name.v1" && fingerprint !== assetNameEvidence(tx, job.familyId, job.entityId).fingerprint) return false;
  if (job.jobType === "suggest.event_metadata.v1" && fingerprint !== eventEvidenceFingerprint(tx, job.familyId, job.entityId, job.id)) return false;
  if (job.jobType === "suggest.inbox_item.v1") {
    // Legacy unversioned suggestions cannot prove the context they used.
    if (job.targetRevision === null || fingerprint !== inboxEvidenceFingerprint(tx, job.familyId, job.entityId)) return false;
    const item = tx.select().from(inboxItem).where(and(eq(inboxItem.id, job.entityId), eq(inboxItem.familyId, job.familyId))).get();
    if (!item || item.titleRevision !== job.targetRevision) return false;
    if (kind === "memory_event") return item.status === "confirmed" && item.memoryEventId === id;
  }
  return job.entityType === kind && job.entityId === id;
}

export async function getNameReview(familyId: string, userId: string, kind: NameTargetKind, id: string) {
  const principal = await principalForNames(familyId, userId);
  if (!principal) return null;
  return getDb().transaction(tx => {
    if (!actorAllowed(tx, principal)) return null;
    const target = targetInTransaction(tx, principal, kind, id);
    if (!target) return null;
    const rows = tx.select().from(aiSuggestion).where(and(eq(aiSuggestion.familyId, familyId), eq(aiSuggestion.entityType, kind), eq(aiSuggestion.entityId, id), eq(aiSuggestion.suggestionType, "title"))).orderBy(desc(aiSuggestion.createdAt), desc(aiSuggestion.id)).limit(50).all();
    const suggestions = rows.flatMap(row => {
      const job = row.createdByJobId ? tx.select().from(aiJob).where(and(eq(aiJob.id, row.createdByJobId), eq(aiJob.familyId, familyId))).get() : null;
      // Unprovable pending provenance and restricted context never become a
      // public title preview. Accepted canonical names remain durable edits.
      if ((row.status === "pending" && (!job || !completedAiResultIsCurrent(tx, job, userId) || !jobTargetsName(tx, job, kind, id, row.sourceFingerprint) || row.provider !== job.providerId || row.model !== job.model)) || (job && job.contentVisibility !== "family" && kind !== "asset")) return [];
      let title: unknown;
      try { title = JSON.parse(row.valueJson).title; } catch { return []; }
      if (!validName(title)) return [];
      return [{ id: row.id, title, status: row.undoneAt ? "undone" : row.status, revision: row.revision,
        targetRevision: row.targetRevision, valid: row.status === "pending" && row.targetRevision === target.revision && job?.status === "completed",
        canUndo: row.status === "accepted" && row.undoneAt === null && row.appliedRevision === target.revision && row.previousNameJson !== null }];
    });
    return { target, suggestions };
  });
}

export async function renameTarget(familyId: string, userId: string, input: { kind: NameTargetKind; id: string; revision: number; title: string }): Promise<NameReviewResult> {
  if (!["asset", "inbox_item", "memory_event"].includes(input.kind) || !validRevision(input.revision) || !validName(input.title)) return { ok: false, error: "invalid_input" };
  const principal = await principalForNames(familyId, userId);
  if (!principal) return { ok: false, error: "forbidden" };
  return getDb().transaction(tx => {
    if (!actorAllowed(tx, principal)) return { ok: false, error: "forbidden" };
    const target = targetInTransaction(tx, principal, input.kind, input.id);
    if (!target) return { ok: false, error: "not_found" };
    if (target.revision !== input.revision) return { ok: false, error: "conflict" };
    const revision = setTargetName(tx, principal, target, input.title.trim(), "manual");
    return { ok: true, targetKind: target.kind, targetId: target.id, revision };
  }, { behavior: "immediate" });
}

/** Versioned, atomic title review shared by Web and native. Never accepts people/time. */
export async function reviewTitleSuggestion(familyId: string, userId: string, input: {
  suggestionId: string; suggestionRevision: number; targetKind: NameTargetKind; targetId: string;
  targetRevision: number; operation: "accept" | "reject" | "undo"; editedTitle?: string;
}): Promise<NameReviewResult> {
  if (!validRevision(input.suggestionRevision) || !validRevision(input.targetRevision) || !["accept", "reject", "undo"].includes(input.operation) || (input.editedTitle !== undefined && !validName(input.editedTitle))) return { ok: false, error: "invalid_input" };
  const principal = await principalForNames(familyId, userId);
  if (!principal) return { ok: false, error: "forbidden" };
  return getDb().transaction(tx => {
    if (!actorAllowed(tx, principal)) return { ok: false, error: "forbidden" };
    const suggestion = tx.select().from(aiSuggestion).where(and(eq(aiSuggestion.id, input.suggestionId), eq(aiSuggestion.familyId, familyId))).get();
    if (!suggestion || suggestion.suggestionType !== "title" || suggestion.entityType !== input.targetKind || suggestion.entityId !== input.targetId) return { ok: false, error: "not_found" };
    if (suggestion.revision !== input.suggestionRevision) return { ok: false, error: "conflict" };
    const target = targetInTransaction(tx, principal, input.targetKind, input.targetId);
    if (!target) return { ok: false, error: "not_found" };
    if (input.operation !== "reject" && target.revision !== input.targetRevision) return { ok: false, error: "conflict" };
    const now = new Date();
    const result = (revision: number): NameReviewResult => ({ ok: true, targetKind: target.kind, targetId: target.id, revision, suggestionRevision: suggestion.revision + 1 });
    if (input.operation === "undo") {
      if (suggestion.status !== "accepted" || suggestion.undoneAt !== null || !suggestion.previousNameJson || suggestion.appliedRevision !== target.revision) return { ok: false, error: "conflict" };
      let previous: { text: string | null; source: string };
      try {
        previous = JSON.parse(suggestion.previousNameJson);
        if (!previous || (previous.text !== null && !validName(previous.text)) || (target.kind === "memory_event" && previous.text === null)) return { ok: false, error: "stale_suggestion" };
      } catch { return { ok: false, error: "stale_suggestion" }; }
      const revision = setTargetName(tx, principal, target, previous.text, nameSource(previous.source));
      tx.update(aiSuggestion).set({ status: "rejected", revision: suggestion.revision + 1, undoneAt: now, resolvedAt: now, resolvedByUserId: userId }).where(eq(aiSuggestion.id, suggestion.id)).run();
      return result(revision);
    }
    if (suggestion.status !== "pending") return { ok: false, error: "already_resolved" };
    if (input.operation === "reject") {
      tx.update(aiSuggestion).set({ status: "rejected", revision: suggestion.revision + 1, resolvedAt: now, resolvedByUserId: userId }).where(eq(aiSuggestion.id, suggestion.id)).run();
      return result(target.revision);
    }
    if (suggestion.targetRevision === null || suggestion.targetRevision !== target.revision) return { ok: false, error: "stale_suggestion" };
    const job = suggestion.createdByJobId ? tx.select().from(aiJob).where(and(eq(aiJob.id, suggestion.createdByJobId), eq(aiJob.familyId, familyId))).get() : null;
    if (job?.contentVisibility !== undefined && job.contentVisibility !== "family" && target.kind !== "asset") return { ok: false, error: "private_context" };
    if (!job || !jobTargetsName(tx, job, target.kind, target.id, suggestion.sourceFingerprint) || suggestion.provider !== job.providerId || suggestion.model !== job.model || !completedAiResultIsCurrent(tx, job, userId)) return { ok: false, error: "stale_suggestion" };
    let proposed: unknown;
    try { proposed = JSON.parse(suggestion.valueJson).title; } catch { return { ok: false, error: "invalid_input" }; }
    const title = input.editedTitle ?? proposed;
    if (!validName(title)) return { ok: false, error: "invalid_input" };
    const revision = setTargetName(tx, principal, target, title.trim(), input.editedTitle === undefined ? "accepted_ai" : "manual");
    tx.update(aiSuggestion).set({ status: "accepted", revision: suggestion.revision + 1, appliedRevision: revision, previousNameJson: JSON.stringify({ text: target.text, source: target.source }), resolvedAt: now, resolvedByUserId: userId }).where(eq(aiSuggestion.id, suggestion.id)).run();
    return result(revision);
  }, { behavior: "immediate" });
}
