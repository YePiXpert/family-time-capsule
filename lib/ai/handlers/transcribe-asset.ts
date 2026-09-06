import { shortVideoError, SHORT_VIDEO_MAX_MS } from "@/lib/ai/media-limits";
import { convertAudioToWav, extractVideoAudio } from "@/lib/media/ffmpeg";
import { probeMedia } from "@/lib/metadata/ffprobe";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
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
  if (asset.type === "audio" && !isAcceptedAudioMimeType(asset.mimeType)) {
    throw new AiJobHandlerError("unsupported_media_type", false);
  }
  if (asset.type === "audio" && asset.bytes > AI_INPUT_LIMITS.maxAudioBytes) {
    throw new AiJobHandlerError("audio_too_large", false);
  }

  const storage = getAssetStorage();
  let bytes: Uint8Array;
  let mimeType = asset.mimeType as AiAudioInput["mimeType"];
  if (asset.type === "video") {
    if (lease.triggerMode !== "manual") throw new AiJobHandlerError("video_requires_manual_request", false);
    const error = shortVideoError(asset);
    if (error) throw new AiJobHandlerError(error, false);
    const absPath = storage.resolvePath(asset.storageKey);
    const probe = await probeMedia(absPath);
    if (!probe || probe.durationMs === null || probe.durationMs <= 0) throw new AiJobHandlerError("video_duration_unknown", false);
    if (probe.durationMs > SHORT_VIDEO_MAX_MS) throw new AiJobHandlerError("video_duration_limit", false);
    const streams = (probe.raw as { streams?: { codec_type?: string }[] }).streams;
    if (!streams?.some(stream => stream.codec_type === "audio")) throw new AiJobHandlerError("video_has_no_audio", false);
    const extracted = await extractVideoAudio(absPath, signal);
    if (extracted.status !== "ok") throw new AiJobHandlerError(extracted.status === "unavailable" ? "ffmpeg_unavailable" : extracted.status === "aborted" ? "ai_aborted" : "audio_extraction_failed", false);
    bytes = extracted.bytes; mimeType = "audio/wav";
  } else bytes = new Uint8Array(storage.read(asset.storageKey));

  // M6 双路由：MiMo ASR 只接受 mp3/wav。音频原件保持不动，
  // 非 mp3/wav 先经 ffmpeg 转成有界 WAV 再送转写；失败给出可读错误
  // 而不是静默降级或截断。
  if (
    assistant.provider.id === "dual-route" &&
    mimeType !== "audio/mpeg" &&
    mimeType !== "audio/wav"
  ) {
    const converted = await convertAudioToWav(storage.resolvePath(asset.storageKey), signal);
    if (converted.status !== "ok") {
      throw new AiJobHandlerError(
        converted.status === "unavailable"
          ? "ffmpeg_unavailable"
          : converted.status === "aborted"
            ? "ai_aborted"
            : converted.status === "too_large"
              ? "audio_too_large"
              : converted.status === "too_long"
                ? "audio_too_large"
                : "audio_conversion_failed",
        false,
      );
    }
    bytes = converted.bytes; mimeType = "audio/wav";
  }
  const extension: Record<AiAudioInput["mimeType"], string> = { "audio/flac": "flac", "audio/m4a": "m4a", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/wav": "wav", "audio/webm": "webm" };

  const result = await assistant.transcribeAudio({
    audio: {
      bytes,
      fileName: `audio.${extension[mimeType]}`,
      mimeType,
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
            revision: sql`${assetTranscript.revision} + 1`,
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
