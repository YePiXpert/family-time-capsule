import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { asset as assetTable } from "@/db/schema/asset";
import { assetAnalysis } from "@/db/schema/analysis";
import { getAssetStorage } from "@/lib/assets/storage";
import { AI_INPUT_LIMITS } from "@/lib/ai/validation";
import type { AiImageInput } from "@/lib/ai/types";
import { AiJobHandlerError, type AiJobHandler } from "@/jobs/types";

const ACCEPTED_VISION_MIME_TYPES = new Set<AiImageInput["mimeType"]>([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ANALYSIS_PROMPT = `请客观分析这张图片，并严格按以下两部分输出（不要添加标题外的其他章节）：

【描述】
只描述图片中直接可见的内容（人物、物体、场景、文字、颜色、构图等）。禁止推测情绪、关系、身份或图片中没有的信息。保持简洁。

【图中文字】
转录图片中所有清晰可见的文字。如果没有可见文字，留空。

【描述】

【图中文字】
`;

function isAcceptedVisionMimeType(mimeType: string): boolean {
  return ACCEPTED_VISION_MIME_TYPES.has(mimeType as AiImageInput["mimeType"]);
}

function parseAnalysisText(text: string): {
  description: string;
  ocrText: string | null;
} {
  const startDesc = text.indexOf("【描述】");
  const startOcr = text.indexOf("【图中文字】");
  if (startDesc === -1 || startOcr === -1 || startOcr <= startDesc) {
    return { description: text.trim(), ocrText: null };
  }
  const descContent = text
    .slice(startDesc + "【描述】".length, startOcr)
    .trim();
  const ocrContent = text.slice(startOcr + "【图中文字】".length).trim();
  return {
    description: descContent.length > 0 ? descContent : text.trim(),
    ocrText: ocrContent.length > 0 ? ocrContent : null,
  };
}

/**
 * Production handler for `analyze.asset_image.v1`.
 *
 * Authorization note: the job queue re-verifies family scope, role capability
 * (`ai:review`) and source visibility at claim time in `inspectRunningJob`, and
 * again inside the finalize transaction. The handler therefore relies on that
 * live revalidation for the visibility/access check, and only asserts that the
 * asset row belongs to the lease's family and is a supported original.
 */
export const analyzeAssetImageHandler: AiJobHandler = async ({
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
    throw new AiJobHandlerError("derivative_not_analyzable", false);
  }
  if (asset.type !== "image") {
    throw new AiJobHandlerError("unsupported_asset_type", false);
  }
  if (asset.bytes > AI_INPUT_LIMITS.maxImageBytes) {
    throw new AiJobHandlerError("image_too_large", false);
  }

  const storage = getAssetStorage();
  let bytes: Uint8Array;
  let analyzedVia: "original" | "thumbnail";
  let sourceStorageKey: string;

  if (isAcceptedVisionMimeType(asset.mimeType)) {
    sourceStorageKey = asset.storageKey;
    bytes = new Uint8Array(storage.read(sourceStorageKey));
    analyzedVia = "original";
  } else {
    const thumbnail = db
      .select()
      .from(assetTable)
      .where(
        and(
          eq(assetTable.familyId, lease.familyId),
          eq(assetTable.originalAssetId, asset.id),
          eq(assetTable.derivativeType, "thumbnail"),
        ),
      )
      .orderBy(desc(assetTable.createdAt))
      .limit(1)
      .get();
    if (!thumbnail) {
      throw new AiJobHandlerError("unsupported_media_type", false);
    }
    sourceStorageKey = thumbnail.storageKey;
    bytes = new Uint8Array(storage.read(sourceStorageKey));
    analyzedVia = "thumbnail";
  }

  // Memory safety: storage.read already loaded the file; re-check the byte cap
  // defensively before handing it to the assistant validator.
  if (bytes.byteLength > AI_INPUT_LIMITS.maxImageBytes) {
    throw new AiJobHandlerError("image_too_large", false);
  }

  const result = await assistant.analyzeImage({
    image: {
      bytes,
      mimeType: isAcceptedVisionMimeType(asset.mimeType)
        ? (asset.mimeType as AiImageInput["mimeType"])
        : "image/jpeg",
    },
    prompt: ANALYSIS_PROMPT,
    signal,
  });

  const parsed = parseAnalysisText(result.text);

  return {
    commit: (tx) => {
      const now = new Date();
      tx.insert(assetAnalysis)
        .values({
          id: randomUUID(),
          familyId: lease.familyId,
          assetId: asset.id,
          description: parsed.description,
          ocrText: parsed.ocrText,
          provider: result.provenance.providerId,
          model: result.provenance.model,
          sourceSha256: asset.sha256,
          analyzedVia,
          createdByJobId: lease.jobId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: assetAnalysis.assetId,
          set: {
            description: parsed.description,
            ocrText: parsed.ocrText,
            provider: result.provenance.providerId,
            model: result.provenance.model,
            sourceSha256: asset.sha256,
            analyzedVia,
            createdByJobId: lease.jobId,
            updatedAt: now,
          },
        })
        .run();
    },
  };
};
