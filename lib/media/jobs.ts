import "server-only";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { asset } from "@/db/schema/asset";
import { mediaJob } from "@/db/schema/media-job";
import type { FamilyContext } from "@/lib/family/context";
import {
  getLiveFamilyPrincipal,
  type LiveFamilyPrincipal,
} from "@/lib/authz/principal";
import {
  createContributionAccessSnapshot,
  getContributionAssetAccessInTransaction,
} from "@/lib/authz/contribution-access";
import { getAssetStorage } from "@/lib/assets/storage";
import { DATA_DIR } from "@/lib/paths";
import {
  convertMedia,
  MEDIA_OUTPUT_LIMIT,
  MediaConversionError,
  type MediaDerivationKind,
} from "./convert";
export class MediaJobError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
function sourceFor(context: FamilyContext | LiveFamilyPrincipal, id: string) {
  const db = getDb();
  const snapshot = createContributionAccessSnapshot({
    ...context,
    userName: "",
  });
  if (
    !db.transaction(
      (tx) =>
        getContributionAssetAccessInTransaction(tx, snapshot, id).readable,
    )
  )
    throw new MediaJobError("source_unavailable", 403);
  const original = db
    .select()
    .from(asset)
    .where(and(eq(asset.id, id), eq(asset.familyId, context.familyId)))
    .get();
  if (!original || original.originalAssetId)
    throw new MediaJobError("original_required", 404);
  return original;
}
export function getMediaDerivations(context: FamilyContext, id: string) {
  sourceFor(context, id);
  const jobs = getDb()
    .select()
    .from(mediaJob)
    .where(
      and(eq(mediaJob.assetId, id), eq(mediaJob.familyId, context.familyId)),
    )
    .all();
  return jobs.map((job) => ({
    kind: job.kind,
    status: job.status,
    outputAssetId: job.status === "succeeded" ? job.outputAssetId : null,
    errorCode: job.errorCode,
  }));
}
export function requestMediaDerivation(
  context: FamilyContext,
  id: string,
  kind: MediaDerivationKind,
) {
  if (!["preview", "waveform", "transcode"].includes(kind))
    throw new MediaJobError("invalid_derivation");
  return getDb().transaction((tx) => {
    const original = sourceFor(context, id);
    if (
      (kind === "preview" && !["image", "video"].includes(original.type)) ||
      (kind !== "preview" && !["video", "audio"].includes(original.type))
    )
      throw new MediaJobError("unsupported_derivation");
    const previous = tx
      .select()
      .from(mediaJob)
      .where(and(eq(mediaJob.assetId, id), eq(mediaJob.kind, kind)))
      .get();
    if (previous && ["queued", "running"].includes(previous.status))
      return previous.id;
    if (
      previous?.status === "succeeded" &&
      previous.outputAssetId &&
      tx.select().from(asset).where(eq(asset.id, previous.outputAssetId)).get()
    )
      return previous.id;
    const pending = tx.get<{ total: number; own: number }>(
      sql`select count(*) total,coalesce(sum(family_id=${context.familyId}),0) own from media_job where status in ('queued','running')`,
    )!;
    const bytes = tx.get<{ bytes: number }>(
      sql`select coalesce(sum(bytes),0) bytes from asset where family_id=${context.familyId} and original_asset_id is not null`,
    )!.bytes;
    if (
      pending.total >= 500 ||
      pending.own >= 100 ||
      bytes + MEDIA_OUTPUT_LIMIT > 2 * 1024 ** 3
    )
      throw new MediaJobError("derivative_quota", 429);
    if (previous) {
      tx.update(mediaJob)
        .set({
          status: "queued",
          requestedBy: context.userId,
          errorCode: null,
          outputAssetId: null,
          updatedAt: new Date(),
        })
        .where(eq(mediaJob.id, previous.id))
        .run();
      return previous.id;
    }
    const jobId = randomUUID();
    tx.insert(mediaJob)
      .values({
        id: jobId,
        familyId: context.familyId,
        assetId: id,
        requestedBy: context.userId,
        kind,
      })
      .run();
    return jobId;
  });
}
/** A DB-wide lease caps conversion concurrency at one across all worker processes. */
export async function runMediaWorkerOnce(
  options: { signal?: AbortSignal } = {},
): Promise<"idle" | "succeeded" | "failed"> {
  const db = getDb();
  const job = db.transaction((tx) => {
    const now = new Date();
    tx.update(mediaJob)
      .set({
        status: "failed",
        errorCode: "worker_interrupted",
        lease: null,
        leaseUntil: null,
        updatedAt: now,
      })
      .where(
        sql`${mediaJob.status}='running' and ${mediaJob.leaseUntil} < ${Math.floor(now.getTime() / 1000)}`,
      )
      .run();
    if (tx.select().from(mediaJob).where(eq(mediaJob.status, "running")).get())
      return null;
    const next = tx
      .select()
      .from(mediaJob)
      .where(eq(mediaJob.status, "queued"))
      .orderBy(asc(mediaJob.createdAt), asc(mediaJob.id))
      .get();
    if (!next) return null;
    const lease = randomUUID();
    tx.update(mediaJob)
      .set({
        status: "running",
        lease,
        leaseUntil: new Date(Date.now() + 240_000),
        updatedAt: now,
      })
      .where(eq(mediaJob.id, next.id))
      .run();
    return { ...next, lease };
  });
  if (!job) return "idle";
  let temporary: string | undefined, publishedKey: string | undefined;
  try {
    const principal = await getLiveFamilyPrincipal(
      job.requestedBy,
      job.familyId,
    );
    const original = sourceFor(principal, job.assetId);
    const root = path.join(DATA_DIR, "work-media");
    await mkdir(root, { recursive: true, mode: 0o700 });
    temporary = await mkdtemp(path.join(root, "convert-"));
    const output = path.join(temporary, "output");
    const storage = getAssetStorage();
    const converted = await convertMedia(
      original,
      job.kind,
      storage.resolvePath(original.storageKey),
      output,
      options.signal,
    );
    sourceFor(
      await getLiveFamilyPrincipal(job.requestedBy, job.familyId),
      job.assetId,
    );
    const outputId = randomUUID();
    const stored = await storage.putDerivativeStream(
      job.kind,
      job.familyId,
      outputId,
      converted.extension,
      createReadStream(output),
      original.capturedAt ?? original.importedAt,
      MEDIA_OUTPUT_LIMIT,
    );
    publishedKey = stored.storageKey;
    const live = await getLiveFamilyPrincipal(job.requestedBy, job.familyId);
    db.transaction((tx) => {
      sourceFor(live, job.assetId);
      const active = tx
        .select()
        .from(mediaJob)
        .where(
          and(
            eq(mediaJob.id, job.id),
            eq(mediaJob.status, "running"),
            eq(mediaJob.lease, job.lease),
          ),
        )
        .get();
      if (
        !active ||
        !active.leaseUntil ||
        active.leaseUntil.getTime() < Date.now() ||
        options.signal?.aborted
      )
        throw new MediaJobError("worker_interrupted");
      const used = tx.get<{ bytes: number }>(
        sql`select coalesce(sum(bytes),0) bytes from asset where family_id=${job.familyId} and original_asset_id is not null`,
      )!.bytes;
      if (used + stored.bytes > 2 * 1024 ** 3)
        throw new MediaJobError("derivative_quota");
      tx.insert(asset)
        .values({
          id: outputId,
          familyId: job.familyId,
          type: converted.type,
          originalFilename: `${job.kind}-${original.originalFilename}`,
          mimeType: converted.mimeType,
          bytes: stored.bytes,
          sha256: stored.sha256,
          storageKey: stored.storageKey,
          capturedAt: original.capturedAt,
          importedAt: new Date(),
          timeSource: original.timeSource,
          createdByUserId: job.requestedBy,
          originalAssetId: original.id,
          derivativeType: job.kind,
          metadataJson: JSON.stringify({
            generator: "media-v1",
            ...(job.kind === "waveform" ? { maxDurationSeconds: 300 } : {}),
          }),
        })
        .run();
      tx.update(mediaJob)
        .set({
          status: "succeeded",
          outputAssetId: outputId,
          lease: null,
          leaseUntil: null,
          errorCode: null,
          updatedAt: new Date(),
        })
        .where(eq(mediaJob.id, job.id))
        .run();
    });
    publishedKey = undefined;
    return "succeeded";
  } catch (error) {
    const code =
      error instanceof MediaJobError
        ? error.code
        : error instanceof MediaConversionError
          ? error.message
          : "conversion_failed";
    db.update(mediaJob)
      .set({
        status: "failed",
        errorCode: code,
        lease: null,
        leaseUntil: null,
        updatedAt: new Date(),
      })
      .where(and(eq(mediaJob.id, job.id), eq(mediaJob.lease, job.lease)))
      .run();
    return "failed";
  } finally {
    if (publishedKey) getAssetStorage().delete(publishedKey);
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

export async function runMediaWorkerLoop(signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      const root = path.join(DATA_DIR, "work-media");
      const entries = await readdir(root).catch(() => []);
      for (const name of entries
        .filter((name) => name.startsWith("convert-"))
        .slice(0, 20)) {
        const target = path.join(root, name);
        const info = await stat(target).catch(() => null);
        if (info && Date.now() - info.mtimeMs > 300_000)
          await rm(target, { recursive: true, force: true });
      }
      if ((await runMediaWorkerOnce({ signal })) !== "idle") continue;
    } catch {
      console.error("[media-worker] processing unavailable; retrying");
    }
    await delay(2000, undefined, { signal }).catch(() => undefined);
  }
}
