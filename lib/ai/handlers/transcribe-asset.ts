import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/db";
import { asset as assetTable } from "@/db/schema/asset";
import { assetTranscript } from "@/db/schema/transcript";
import { getAssetStorage } from "@/lib/assets/storage";
import { AI_INPUT_LIMITS } from "@/lib/ai/validation";
import type { AiAudioInput } from "@/lib/ai/types";
import { AiJobHandlerError, type AiJobHandler } from "@/jobs/types";

const ACCEPTED_AUDIO_MIME_TYPES = new Set<AiAudioInput["mimeType"]>([
  "audio/flac",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
]);

function isAcceptedAudioMimeType(mimeType: string): boolean {
  return ACCEPTED_AUDIO_MIME_TYPES.has(mimeType as AiAudioInput["mimeType"]);
}

/**
 * Production handler for `transcribe.asset.v1`.
 *
 * Authorization note: the job queue re-verifies family scope, role capability
 * (`ai:review`) and source visibility at claim time in `inspectRunningJob`, and
 * again inside the finalize transaction. The handler therefore relies on that
 * live revalidation for the visibility/access check, and only asserts that the
 * asset row belongs to the lease's family and is a supported original.
 */
export const transcribeAssetHandler: AiJobHandler = async ({
  lease,
  assistant,
  signal,
}) => {
  const db = getDb();
  const asset = db
    .select()
    .from(assetTable)
    .where(
      and(
        eq(assetTable.id, lease.entityId),
        eq(assetTable.familyId, lease.familyId),
      ),
    )
    .limit(1)
    .get();

  if (!asset) {
    throw new AiJobHandlerError("asset_not_found", false);
  }
  if (asset.originalAssetId !== null) {
    throw new AiJobHandlerError("derivative_not_transcribable", false);
  }
  if (asset.type !== "audio" && asset.type !== "video") {
    throw new AiJobHandlerError("unsupported_asset_type", false);
  }
  if (!isAcceptedAudioMimeType(asset.mimeType)) {
    throw new AiJobHandlerError("unsupported_media_type", false);
  }
  if (asset.bytes > AI_INPUT_LIMITS.maxAudioBytes) {
    throw new AiJobHandlerError("audio_too_large", false);
  }

  const storage = getAssetStorage();
  const buffer = storage.read(asset.storageKey);
  const bytes = new Uint8Array(buffer);

  const result = await assistant.transcribeAudio({
    audio: {
      bytes,
      fileName: "audio.mp3",
      mimeType: asset.mimeType as AiAudioInput["mimeType"],
    },
    signal,
  });

  return {
    commit: (tx) => {
      const segmentsJson =
        result.segments.length > 0 ? JSON.stringify(result.segments) : null;
      const now = new Date();

      tx.insert(assetTranscript)
        .values({
          id: randomUUID(),
          familyId: lease.familyId,
          assetId: asset.id,
          language: result.language,
          provider: result.provenance.providerId,
          model: result.provenance.model,
          rawTranscript: result.text,
          editedTranscript: null,
          segmentsJson,
          status: "machine",
          sourceSha256: asset.sha256,
          createdByJobId: lease.jobId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: assetTranscript.assetId,
          set: {
            language: result.language,
            provider: result.provenance.providerId,
            model: result.provenance.model,
            rawTranscript: result.text,
            segmentsJson,
            sourceSha256: asset.sha256,
            createdByJobId: lease.jobId,
            updatedAt: now,
            // status and editedTranscript are intentionally excluded:
            // user edits are durable and must never be overwritten by a rerun.
          },
        })
        .run();
    },
  };
};
