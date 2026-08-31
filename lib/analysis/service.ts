import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { asset as assetTable } from "@/db/schema/asset";
import { aiJob } from "@/db/schema/ai-job";
import { assetAnalysis } from "@/db/schema/analysis";
import { assertFamilyCapability } from "@/lib/authz/policy";
import {
  createContributionAccessSnapshot,
  getContributionAssetAccessInTransaction,
} from "@/lib/authz/contribution-access";
import { enqueueAiJob, type AiJobServiceDependencies } from "@/lib/ai/jobs";
import { AI_INPUT_LIMITS } from "@/lib/ai/validation";
import type { FamilyContext } from "@/lib/family/context";
import type { AssetAnalysisRow } from "@/db/schema/analysis";

const ACCEPTED_VISION_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type ImageAnalysisRequestResult =
  | { ok: true; jobId: string; created: boolean }
  | { ok: false; error: string };

function validateAssetForImageAnalysis(
  asset: typeof assetTable.$inferSelect,
): { ok: true } | { ok: false; error: string } {
  if (asset.originalAssetId !== null) {
    return { ok: false, error: "derivative_not_analyzable" };
  }
  if (asset.type !== "image") {
    return { ok: false, error: "unsupported_asset_type" };
  }
  if (asset.bytes > AI_INPUT_LIMITS.maxImageBytes) {
    return { ok: false, error: "image_too_large" };
  }
  return { ok: true };
}

function loadAssetInFamily(familyId: string, assetId: string) {
  return getDb()
    .select()
    .from(assetTable)
    .where(
      and(eq(assetTable.id, assetId), eq(assetTable.familyId, familyId)),
    )
    .limit(1)
    .get();
}

function hasVisionReadableInput(
  db: ReturnType<typeof getDb>,
  asset: typeof assetTable.$inferSelect,
): boolean {
  if (ACCEPTED_VISION_MIME_TYPES.has(asset.mimeType)) {
    return true;
  }
  const thumbnail = db
    .select({ id: assetTable.id })
    .from(assetTable)
    .where(
      and(
        eq(assetTable.familyId, asset.familyId),
        eq(assetTable.originalAssetId, asset.id),
        eq(assetTable.derivativeType, "thumbnail"),
      ),
    )
    .limit(1)
    .get();
  return Boolean(thumbnail);
}

export async function getAnalysisForAsset(
  familyId: string,
  assetId: string,
): Promise<AssetAnalysisRow | undefined> {
  return getDb()
    .select()
    .from(assetAnalysis)
    .where(
      and(
        eq(assetAnalysis.familyId, familyId),
        eq(assetAnalysis.assetId, assetId),
      ),
    )
    .limit(1)
    .get();
}

export async function getAnalysesForAssets(
  familyId: string,
  assetIds: readonly string[],
): Promise<Map<string, AssetAnalysisRow>> {
  if (assetIds.length === 0) return new Map();
  const rows = await getDb()
    .select()
    .from(assetAnalysis)
    .where(
      and(
        eq(assetAnalysis.familyId, familyId),
        inArray(assetAnalysis.assetId, [...assetIds]),
      ),
    );
  return new Map(rows.map((row) => [row.assetId, row]));
}

export async function getLatestImageAnalysisJobForAsset(
  familyId: string,
  assetId: string,
): Promise<typeof aiJob.$inferSelect | undefined> {
  return getDb()
    .select()
    .from(aiJob)
    .where(
      and(
        eq(aiJob.familyId, familyId),
        eq(aiJob.jobType, "analyze.asset_image.v1"),
        eq(aiJob.entityId, assetId),
      ),
    )
    .orderBy(desc(aiJob.createdAt))
    .limit(1)
    .get();
}

export async function getLatestVideoAnalysisJobForAsset(
  familyId: string,
  assetId: string,
): Promise<typeof aiJob.$inferSelect | undefined> {
  return getDb()
    .select()
    .from(aiJob)
    .where(
      and(
        eq(aiJob.familyId, familyId),
        eq(aiJob.jobType, "analyze.asset_video.v1"),
        eq(aiJob.entityId, assetId),
      ),
    )
    .orderBy(desc(aiJob.createdAt))
    .limit(1)
    .get();
}

/**
 * Request AI video analysis (M3-G). Caller must already hold `ai:review`;
 * re-checks capability, asset type/visibility, then enqueues a durable job.
 * The handler extracts representative frames with ffmpeg; when ffmpeg is
 * unavailable the job fails non-retryably and the archive is unaffected.
 */
export function requestVideoAnalysis(
  context: FamilyContext,
  assetId: string,
  options: AiJobServiceDependencies & { now?: Date } = {},
): ImageAnalysisRequestResult {
  try {
    assertFamilyCapability(context.role, "ai:review");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const asset = loadAssetInFamily(context.familyId, assetId);
  if (!asset) {
    return { ok: false, error: "asset_not_found" };
  }
  if (asset.originalAssetId !== null) {
    return { ok: false, error: "derivative_not_analyzable" };
  }
  if (asset.type !== "video") {
    return { ok: false, error: "unsupported_asset_type" };
  }

  const snapshot = createContributionAccessSnapshot(context, options.now);
  const access = getDb().transaction((tx) =>
    getContributionAssetAccessInTransaction(tx, snapshot, assetId),
  );
  if (!access.readable) {
    return { ok: false, error: "source_forbidden_or_not_found" };
  }

  return enqueueAiJob(
    {
      familyId: context.familyId,
      requestedByUserId: context.userId,
      jobType: "analyze.asset_video.v1",
      entityType: "asset",
      entityId: assetId,
      requiredCapability: "vision",
      triggerMode: "manual",
      sources: [{ kind: "asset", id: assetId }],
    },
    options,
  );
}

/**
 * Request AI image analysis for an asset. Caller must already hold `ai:review`
 * capability; this helper re-checks capability and asset visibility before
 * enqueueing a durable job.
 */
export function requestImageAnalysis(
  context: FamilyContext,
  assetId: string,
  options: AiJobServiceDependencies & { now?: Date } = {},
): ImageAnalysisRequestResult {
  try {
    assertFamilyCapability(context.role, "ai:review");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const asset = loadAssetInFamily(context.familyId, assetId);
  if (!asset) {
    return { ok: false, error: "asset_not_found" };
  }
  const validation = validateAssetForImageAnalysis(asset);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  if (!hasVisionReadableInput(getDb(), asset)) {
    return { ok: false, error: "unsupported_media_type" };
  }

  const snapshot = createContributionAccessSnapshot(context, options.now);
  const access = getDb().transaction((tx) =>
    getContributionAssetAccessInTransaction(tx, snapshot, assetId),
  );
  if (!access.readable) {
    return { ok: false, error: "source_forbidden_or_not_found" };
  }

  return enqueueAiJob(
    {
      familyId: context.familyId,
      requestedByUserId: context.userId,
      jobType: "analyze.asset_image.v1",
      entityType: "asset",
      entityId: assetId,
      requiredCapability: "vision",
      triggerMode: "manual",
      sources: [{ kind: "asset", id: assetId }],
    },
    options,
  );
}
