import "server-only";
import { getDb } from "@/db";
import type { FamilyContext } from "@/lib/family/context";
import type { AiJobServiceDependencies } from "@/lib/ai/jobs";
import { requestEventSuggestions } from "@/lib/suggestions/service";
import { getDraft, publishDraft } from "./service";
import type { Draft } from "./model";
import type { CaptureProcessing } from "@/mobile/src/drafts/capture";

export type CaptureResult = Draft & { processing: CaptureProcessing };

/** The button explicitly requests this event's organization. Queue only: no
 * external I/O during save. Publish and the durable queue commit together;
 * refusal rolls back the AI subtransaction while preserving the memory. */
export function publishCapture(context: FamilyContext, id: string, revision: number, organize: boolean, dependencies: AiJobServiceDependencies & { inferTime?: boolean } = {}): CaptureResult {
  return getDb().transaction(() => {
    // A retry after an acknowledged/lost response must not launch fresh work,
    // even if the title, provider or consent changed since the first save.
    const previous = getDraft(context, id);
    const saved = publishDraft(context, id, revision, { inferTime: dependencies.inferTime !== false });
    if (previous.status === "published") return { ...saved, processing: { state: "skipped", reason: "already_saved" } };
    if (!organize || saved.visibility !== "family") return { ...saved, processing: { state: "skipped", reason: saved.visibility === "family" ? "not_requested" : "private_content" } };
    try {
      const result = requestEventSuggestions(context, saved.memoryEventId!, dependencies);
      return { ...saved, processing: result.ok ? { state: "queued", jobId: result.jobId } : { state: "skipped", reason: result.error } };
    } catch {
      return { ...saved, processing: { state: "skipped", reason: "organizer_unavailable" } };
    }
  }, { behavior: "immediate" });
}
