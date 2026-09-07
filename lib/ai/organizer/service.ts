import "server-only";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { aiJob, aiJobDependency } from "@/db/schema/ai-job";
import { asset } from "@/db/schema/asset";
import { inboxItem, inboxItemAsset } from "@/db/schema/inbox";
import { memoryEvent, memoryEventAsset } from "@/db/schema/memory";
import { aiSuggestion } from "@/db/schema/suggestion";
import { assetTranscript } from "@/db/schema/transcript";
import { createContributionAccessSnapshot, getContributionAssetAccessInTransaction, type ContributionAccessTransaction as Tx } from "@/lib/authz/contribution-access";
import type { FamilyContext } from "@/lib/family/context";
import { getNameReview } from "@/lib/names/service";
import { requestEventSuggestions, requestInboxItemSuggestions, requestAssetNameSuggestion } from "@/lib/suggestions/service";
import { requestTranscription } from "@/lib/transcripts/service";
import { aiJobSourcesAreReadable, getAiOperationalStatus, requestAiJobCancellation, retryAiJob, type AiJobServiceDependencies } from "@/lib/ai/jobs/service";
import { aiJobFailureMessage } from "@/lib/ai/job-messages";
import type { OrganizerReview, OrganizerTarget, OrganizerTask, OrganizerOperation } from "@/mobile/src/ai/organizer-types";

const namingTypes = ["suggest.asset_name.v1", "suggest.inbox_item.v1", "suggest.event_metadata.v1"];
const supportedTypes = [...namingTypes, "transcribe.asset.v1"];
function targetExists(tx: Tx, context: FamilyContext, target: OrganizerTarget): boolean {
  if (target.kind === "memory_event") return Boolean(tx.select({ id: memoryEvent.id }).from(memoryEvent).where(and(eq(memoryEvent.id, target.id), eq(memoryEvent.familyId, context.familyId), isNull(memoryEvent.deletedAt))).get());
  if (target.kind === "inbox_item") {
    if (!tx.select({ id: inboxItem.id }).from(inboxItem).where(and(eq(inboxItem.id, target.id), eq(inboxItem.familyId, context.familyId), inArray(inboxItem.status, ["new", "needs_review", "processing", "confirmed"]))).get()) return false;
    const ids = tx.select({ id: inboxItemAsset.assetId }).from(inboxItemAsset).where(eq(inboxItemAsset.inboxItemId, target.id)).all();
    return ids.every(row => getContributionAssetAccessInTransaction(tx, createContributionAccessSnapshot(context), row.id).readable);
  }
  const original = tx.select().from(asset).where(and(eq(asset.id, target.id), eq(asset.familyId, context.familyId), isNull(asset.originalAssetId))).get();
  return Boolean(original && getContributionAssetAccessInTransaction(tx, createContributionAccessSnapshot(context), target.id).readable);
}
function targetJobs(tx: Tx, context: FamilyContext, target: OrganizerTarget) {
  const linked = target.kind === "memory_event" ? tx.select({ id: inboxItem.id }).from(inboxItem).where(and(eq(inboxItem.familyId, context.familyId), eq(inboxItem.memoryEventId, target.id), eq(inboxItem.status, "confirmed"))).all().map(row => row.id) : [];
  return tx.select().from(aiJob).where(and(eq(aiJob.familyId, context.familyId), eq(aiJob.requestedByUserId, context.userId), inArray(aiJob.jobType, supportedTypes), or(and(eq(aiJob.entityType, target.kind), eq(aiJob.entityId, target.id)), linked.length ? and(eq(aiJob.entityType, "inbox_item"), inArray(aiJob.entityId, linked)) : undefined))).orderBy(desc(aiJob.createdAt), desc(sql`${aiJob}.rowid`)).limit(10).all().filter(job => aiJobSourcesAreReadable(tx, context, job));
}
function taskDto(tx: Tx, job: typeof aiJob.$inferSelect): OrganizerTask {
  const parents = tx.select({ job: aiJob }).from(aiJobDependency).innerJoin(aiJob, eq(aiJob.id, aiJobDependency.dependsOnJobId)).where(eq(aiJobDependency.jobId, job.id)).all().map(row => row.job);
  const active = ["pending", "running"].includes(job.status);
  const stages = [...parents, job];
  const state: OrganizerTask["state"] = job.cancelRequestedAt && active ? "cancelling" : job.lastErrorCode === "insufficient_evidence" ? "insufficient"
    : job.status === "failed" || job.lastErrorCode === "dependency_failed" || parents.some(parent => parent.status === "failed") ? "failed"
    : job.status === "cancelled" ? "cancelled" : job.status === "completed" ? "ready"
    : job.status === "running" ? namingTypes.includes(job.jobType) ? "naming" : "analyzing"
    : parents.some(parent => parent.status === "running") ? "analyzing"
    : parents.some(parent => parent.status !== "completed") ? "waiting_analysis"
    : namingTypes.includes(job.jobType) ? "waiting_naming" : "waiting_analysis";
  const labels: Record<OrganizerTask["state"], string> = { waiting_analysis: "等待分析或转写", analyzing: "正在分析或转写", waiting_naming: "依据已准备好，等待起名", naming: "正在生成整理建议", ready: "整理已完成，可查看全文和审核建议", insufficient: "依据不足", failed: "整理未完成", cancelled: "任务已取消", cancelling: "正在停止本地处理；已发出的远端请求可能仍在处理" };
  const failed = stages.find(row => row.status === "failed");
  return { id: job.id, state, active, message: ["failed", "insufficient"].includes(state) ? aiJobFailureMessage(failed?.lastErrorCode ?? job.lastErrorCode) : labels[state], steps: stages.map(row => ({ label: row.jobType === "analyze.asset_image.v1" ? "看图" : row.jobType === "analyze.asset_video.v1" ? "理解视频画面" : row.jobType === "transcribe.asset.v1" ? "转成文字" : "生成标题建议", status: row.status as OrganizerTask["steps"][number]["status"] })), canCancel: active && !job.cancelRequestedAt, canRetry: ["failed", "cancelled"].includes(job.status), canRegenerate: job.status === "completed" && namingTypes.includes(job.jobType) };
}
export async function getOrganizerReview(context: FamilyContext, target: OrganizerTarget, options: AiJobServiceDependencies = {}): Promise<OrganizerReview | null> {
  const db = options.database ?? getDb();
  const snapshot = db.transaction(tx => {
    const settings = getAiOperationalStatus(context, options);
    if (!settings || !targetExists(tx, context, target)) return null;
    const ids = target.kind === "asset" ? [target.id] : target.kind === "inbox_item" ? tx.select({ id: inboxItemAsset.assetId }).from(inboxItemAsset).where(eq(inboxItemAsset.inboxItemId, target.id)).all().map(row => row.id) : tx.select({ id: memoryEventAsset.assetId }).from(memoryEventAsset).where(eq(memoryEventAsset.memoryEventId, target.id)).all().map(row => row.id);
    const visible = ids.filter(id => getContributionAssetAccessInTransaction(tx, createContributionAccessSnapshot(context), id).readable);
    const transcripts = visible.length ? tx.select().from(assetTranscript).where(and(eq(assetTranscript.familyId, context.familyId), inArray(assetTranscript.assetId, visible))).all().map(row => ({ assetId: row.assetId, text: row.editedTranscript ?? row.rawTranscript, edited: row.editedTranscript !== null, revision: row.revision })) : [];
    return { target, settings, tasks: targetJobs(tx, context, target).map(job => taskDto(tx, job)), transcripts };
  });
  if (!snapshot) return null;
  return { ...snapshot, names: await getNameReview(context.familyId, context.userId, target.kind, target.id) };
}
export function mutateOrganizer(context: FamilyContext, target: OrganizerTarget, operation: OrganizerOperation, jobId?: string, options: AiJobServiceDependencies = {}): { ok: true; jobId?: string } | { ok: false; error: string } {
  const db = options.database ?? getDb();
  return db.transaction(tx => {
    if (!getAiOperationalStatus(context, options)) return { ok: false, error: "forbidden" };
    if (!targetExists(tx, context, target)) return { ok: false, error: "not_found" };
    const jobs = targetJobs(tx, context, target);
    if (operation === "name") {
      if (target.kind === "asset") return requestAssetNameSuggestion(context, target.id, options);
      return target.kind === "inbox_item" ? requestInboxItemSuggestions(context, target.id, options) : requestEventSuggestions(context, target.id, options);
    }
    if (operation === "transcribe") return target.kind === "asset" ? requestTranscription(context, target.id, options) : { ok: false, error: "invalid_input" };
    const job = jobs.find(row => row.id === jobId);
    if (!job) return { ok: false, error: "not_found" };
    if (operation === "cancel") return requestAiJobCancellation(context, job.id, options);
    if (operation === "retry") return retryAiJob(context, job.id, options);
    if (operation !== "regenerate" || job.status !== "completed" || !namingTypes.includes(job.jobType)) return { ok: false, error: "invalid_input" };
    // An explicit repeat is bounded to this prior job; duplicate taps reuse it.
    const result = target.kind === "asset" ? requestAssetNameSuggestion(context, target.id, { ...options, regenerateFrom: job.id }) : target.kind === "inbox_item" ? requestInboxItemSuggestions(context, target.id, { ...options, regenerateFrom: job.id }) : requestEventSuggestions(context, target.id, { ...options, regenerateFrom: job.id });
    if (result.ok) tx.update(aiSuggestion).set({ status: "rejected", revision: sql`${aiSuggestion.revision} + 1`, resolvedByUserId: context.userId, resolvedAt: new Date() }).where(and(eq(aiSuggestion.createdByJobId, job.id), eq(aiSuggestion.familyId, context.familyId), eq(aiSuggestion.status, "pending"))).run();
    return result;
  }, { behavior: "immediate" });
}
