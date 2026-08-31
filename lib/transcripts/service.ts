import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { asset as assetTable } from "@/db/schema/asset";
import { aiJob } from "@/db/schema/ai-job";
import { assetTranscript } from "@/db/schema/transcript";
import { assertFamilyCapability } from "@/lib/authz/policy";
import {
  createContributionAccessSnapshot,
  getContributionAssetAccessInTransaction,
} from "@/lib/authz/contribution-access";
import { enqueueAiJob, type AiJobServiceDependencies } from "@/lib/ai/jobs";
import { AI_INPUT_LIMITS } from "@/lib/ai/validation";
import type { FamilyContext } from "@/lib/family/context";
import type { AssetTranscriptRow } from "@/db/schema/transcript";

const ACCEPTED_AUDIO_MIME_TYPES = new Set([
  "audio/flac",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
]);

const MAX_EDITED_TRANSCRIPT_CHARS = 200_000;

export type TranscriptRequestResult =
  | { ok: true; jobId: string; created: boolean }
  | { ok: false; error: string };

export type EditTranscriptResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "not_found" | "forbidden" };

function validateAssetForTranscription(asset: typeof assetTable.$inferSelect): {
  ok: true;
} | { ok: false; error: string } {
  if (asset.originalAssetId !== null) {
    return { ok: false, error: "derivative_not_transcribable" };
  }
  if (asset.type !== "audio" && asset.type !== "video") {
    return { ok: false, error: "unsupported_asset_type" };
  }
  if (!ACCEPTED_AUDIO_MIME_TYPES.has(asset.mimeType)) {
    return { ok: false, error: "unsupported_media_type" };
  }
  if (asset.bytes > AI_INPUT_LIMITS.maxAudioBytes) {
    return { ok: false, error: "audio_too_large" };
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

export async function getTranscriptForAsset(
  familyId: string,
  assetId: string,
): Promise<AssetTranscriptRow | undefined> {
  return getDb()
    .select()
    .from(assetTranscript)
    .where(
      and(
        eq(assetTranscript.familyId, familyId),
        eq(assetTranscript.assetId, assetId),
      ),
    )
    .limit(1)
    .get();
}

export async function getTranscriptsForAssets(
  familyId: string,
  assetIds: readonly string[],
): Promise<Map<string, AssetTranscriptRow>> {
  if (assetIds.length === 0) return new Map();
  const rows = await getDb()
    .select()
    .from(assetTranscript)
    .where(
      and(
        eq(assetTranscript.familyId, familyId),
        inArray(assetTranscript.assetId, [...assetIds]),
      ),
    );
  return new Map(rows.map((row) => [row.assetId, row]));
}

export async function getLatestTranscriptionJobForAsset(
  familyId: string,
  assetId: string,
): Promise<typeof aiJob.$inferSelect | undefined> {
  return getDb()
    .select()
    .from(aiJob)
    .where(
      and(
        eq(aiJob.familyId, familyId),
        eq(aiJob.jobType, "transcribe.asset.v1"),
        eq(aiJob.entityId, assetId),
      ),
    )
    .orderBy(desc(aiJob.createdAt))
    .limit(1)
    .get();
}

/**
 * Request AI transcription for an asset. Caller must already hold `ai:review`
 * capability; this helper re-checks capability and asset visibility before
 * enqueueing a durable job.
 */
export function requestTranscription(
  context: FamilyContext,
  assetId: string,
  options: AiJobServiceDependencies & { now?: Date } = {},
): TranscriptRequestResult {
  try {
    assertFamilyCapability(context.role, "ai:review");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const asset = loadAssetInFamily(context.familyId, assetId);
  if (!asset) {
    return { ok: false, error: "asset_not_found" };
  }
  const validation = validateAssetForTranscription(asset);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
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
      jobType: "transcribe.asset.v1",
      entityType: "asset",
      entityId: assetId,
      requiredCapability: "transcription",
      triggerMode: "manual",
      sources: [{ kind: "asset", id: assetId }],
    },
    options,
  );
}

export function saveEditedTranscript(
  context: FamilyContext,
  assetId: string,
  text: string,
): EditTranscriptResult {
  try {
    assertFamilyCapability(context.role, "event:write");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_EDITED_TRANSCRIPT_CHARS) {
    return { ok: false, error: "invalid" };
  }

  return getDb().transaction((tx) => {
    const asset = tx
      .select()
      .from(assetTable)
      .where(
        and(
          eq(assetTable.id, assetId),
          eq(assetTable.familyId, context.familyId),
        ),
      )
      .limit(1)
      .get();
    if (!asset) return { ok: false, error: "not_found" } as const;

    const existing = tx
      .select()
      .from(assetTranscript)
      .where(
        and(
          eq(assetTranscript.familyId, context.familyId),
          eq(assetTranscript.assetId, assetId),
        ),
      )
      .limit(1)
      .get();

    const now = new Date();
    if (existing) {
      tx.update(assetTranscript)
        .set({
          editedTranscript: trimmed,
          status: "user_edited",
          updatedAt: now,
        })
        .where(eq(assetTranscript.id, existing.id))
        .run();
    } else {
      tx.insert(assetTranscript)
        .values({
          id: randomUUID(),
          familyId: context.familyId,
          assetId,
          language: null,
          provider: "",
          model: "",
          rawTranscript: "",
          editedTranscript: trimmed,
          segmentsJson: null,
          status: "user_edited",
          sourceSha256: asset.sha256,
          createdByJobId: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    return { ok: true } as const;
  });
}

