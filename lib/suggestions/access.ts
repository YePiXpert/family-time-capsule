import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { aiJob } from "@/db/schema/ai-job";
import { aiSuggestion, type AiSuggestionRow } from "@/db/schema/suggestion";
import { inboxItem } from "@/db/schema/inbox";
import { memoryEvent } from "@/db/schema/memory";
import { asset } from "@/db/schema/asset";
import { inboxEvidenceFingerprint } from "@/lib/ai/inbox-evidence";
import { eventEvidenceFingerprint } from "@/lib/ai/event-evidence";
import { completedAiResultIsCurrent, type AiJobServiceDependencies } from "@/lib/ai/jobs/service";
import type { ContributionAccessTransaction } from "@/lib/authz/contribution-access";

/** All pending fields carry the same source/permission boundary as titles.
 * Reviewed canonical edits do not depend on a currently enabled provider. */
export function pendingSuggestionIsCurrent(tx: ContributionAccessTransaction, row: AiSuggestionRow, userId: string, options: AiJobServiceDependencies = {}): boolean {
  if (row.status !== "pending" || row.targetRevision === null || !row.createdByJobId) return false;
  const job = tx.select().from(aiJob).where(and(eq(aiJob.id, row.createdByJobId), eq(aiJob.familyId, row.familyId))).get();
  if (!job || job.contentVisibility !== "family" || row.provider !== job.providerId || row.model !== job.model || !completedAiResultIsCurrent(tx, job, userId, options)) return false;
  if (job.jobType === "suggest.event_metadata.v1" && row.sourceFingerprint !== eventEvidenceFingerprint(tx, row.familyId, job.entityId, job.id)) return false;
  if (job.entityType === "inbox_item") {
    const item = tx.select().from(inboxItem).where(and(eq(inboxItem.id, job.entityId), eq(inboxItem.familyId, row.familyId))).get();
    if (!item || item.titleRevision !== job.targetRevision || row.sourceFingerprint !== inboxEvidenceFingerprint(tx, row.familyId, item.id)) return false;
    if (row.entityType === "memory_event") {
      if (item.status !== "confirmed" || item.memoryEventId !== row.entityId) return false;
    } else if (row.entityType !== "inbox_item" || row.entityId !== item.id || !["new", "processing", "needs_review"].includes(item.status)) return false;
  } else if (job.entityType !== row.entityType || job.entityId !== row.entityId) return false;
  if (row.entityType === "inbox_item") return tx.select({ revision: inboxItem.titleRevision }).from(inboxItem).where(and(eq(inboxItem.id, row.entityId), eq(inboxItem.familyId, row.familyId))).get()?.revision === row.targetRevision;
  if (row.entityType === "memory_event") return tx.select({ revision: memoryEvent.titleRevision }).from(memoryEvent).where(and(eq(memoryEvent.id, row.entityId), eq(memoryEvent.familyId, row.familyId), isNull(memoryEvent.deletedAt))).get()?.revision === row.targetRevision;
  if (row.entityType === "asset") return tx.select({ revision: asset.nameRevision }).from(asset).where(and(eq(asset.id, row.entityId), eq(asset.familyId, row.familyId))).get()?.revision === row.targetRevision;
  return false;
}

export function listReviewableSuggestions(familyId: string, userId: string, entityType: string, entityId: string): AiSuggestionRow[] {
  return getDb().transaction(tx => tx.select().from(aiSuggestion).where(and(eq(aiSuggestion.familyId, familyId), eq(aiSuggestion.entityType, entityType), eq(aiSuggestion.entityId, entityId), eq(aiSuggestion.status, "pending"))).orderBy(aiSuggestion.createdAt).all().filter(row => pendingSuggestionIsCurrent(tx, row, userId)));
}
