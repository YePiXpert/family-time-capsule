import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import type { Readable } from "node:stream";
import { and, asc, count, desc, eq, inArray, lt, max, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { asset, documentText } from "@/db/schema/asset";
import {
  importSession,
  importSessionDefaultParticipant,
  importSessionItem,
  uploadSession,
} from "@/db/schema/import";
import { inboxItem, inboxItemAsset } from "@/db/schema/inbox";
import { inboxItemParticipant } from "@/db/schema/inbox";
import { person } from "@/db/schema/family";
import {
  classifyDeclaredUpload,
  parseImageSize,
  validateUploadPrefix,
  type UploadAssetType,
} from "@/lib/assets/validation";
import {
  buildOriginalStorageKey,
  getAssetStorage,
  OriginalExistsError,
  UploadLengthError,
  UploadOffsetError,
  UploadReplayMismatchError,
} from "@/lib/assets/storage";
import {
  findOriginalBySha256,
  sanitizeDisplayFilename,
  type AssetRow,
  type TimeSource,
} from "@/lib/assets/service";
import { getFamily } from "@/lib/family/service";
import { createInboxItemForAssetIdempotent } from "@/lib/inbox/service";
import {
  embeddedTimeToUtc,
  extractEmbeddedTimeFromFile,
} from "@/lib/metadata/time";
import { probeMedia } from "@/lib/metadata/ffprobe";

export const RESUMABLE_CHUNK_BYTES = 8 * 1024 * 1024;
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_ACTIVE_UPLOADS_PER_FAMILY = 20;
export const MAX_TEMP_BYTES_PER_FAMILY = 5 * 1024 * 1024 * 1024;
const VALIDATION_PREFIX_BYTES = 1024 * 1024;
const ACTIVE_STATUSES = ["created", "uploading"] as const;

export type UploadSessionRow = typeof uploadSession.$inferSelect;
export type ImportSessionRow = typeof importSession.$inferSelect;

export class UploadServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly uploadOffset?: number,
  ) {
    super(code);
    this.name = "UploadServiceError";
  }
}

export type CreateImportSessionInput = {
  familyId: string;
  createdByUserId: string | null;
  source: "web" | "native" | "share" | "guest";
  defaultTitle?: string | null;
  defaultOccurredAt?: Date | null;
  defaultLocationText?: string | null;
  participantPersonIds?: string[];
};

export async function createImportSession(
  input: CreateImportSessionInput,
): Promise<ImportSessionRow> {
  const now = new Date();
  const id = randomUUID();
  const participantIds = [...new Set(input.participantPersonIds ?? [])];
  if (participantIds.length > 50) throw new UploadServiceError("invalid_participants", 400);
  if (participantIds.length > 0) {
    const valid = await getDb()
      .select({ id: person.id })
      .from(person)
      .where(and(eq(person.familyId, input.familyId), inArray(person.id, participantIds)));
    if (valid.length !== participantIds.length) {
      throw new UploadServiceError("invalid_participants", 400);
    }
  }
  return getDb().transaction((tx) => {
    const session = tx.insert(importSession).values({
      id,
      familyId: input.familyId,
      source: input.source,
      status: "collecting",
      totalCount: 0,
      completedCount: 0,
      failedCount: 0,
      defaultTitle: input.defaultTitle?.trim().slice(0, 200) || null,
      defaultOccurredAt: input.defaultOccurredAt ?? null,
      defaultLocationText: input.defaultLocationText?.trim().slice(0, 200) || null,
      createdByUserId: input.createdByUserId,
      createdAt: now,
      updatedAt: now,
    }).returning().get();
    if (participantIds.length > 0) {
      tx.insert(importSessionDefaultParticipant).values(
        participantIds.map((personId) => ({
          id: randomUUID(),
          familyId: input.familyId,
          importSessionId: id,
          personId,
          createdAt: now,
        })),
      ).run();
    }
    return session;
  });
}

export type CreateUploadInput = {
  familyId: string;
  userId: string;
  captureId: string;
  filename: string;
  declaredMime: string;
  totalBytes: number;
  lastModified: Date | null;
  source: "web" | "native" | "share";
  importSessionId: string | null;
  clientFingerprint?: string | null;
};

function sameDeclaration(row: UploadSessionRow, input: CreateUploadInput): boolean {
  return (
    row.userId === input.userId &&
    row.filename === sanitizeDisplayFilename(input.filename) &&
    row.declaredMime === classifyDeclaredUpload(input.declaredMime)?.mimeType &&
    row.totalBytes === input.totalBytes &&
    (row.lastModified?.getTime() ?? null) === (input.lastModified?.getTime() ?? null) &&
    row.source === input.source &&
    row.importSessionId === input.importSessionId
    && row.clientFingerprint === (input.clientFingerprint ?? null)
  );
}

export async function createUploadSession(
  input: CreateUploadInput,
): Promise<{ session: UploadSessionRow; existing: boolean }> {
  const declaration = classifyDeclaredUpload(input.declaredMime);
  if (!declaration) throw new UploadServiceError("mime_not_allowed", 415);
  if (!Number.isSafeInteger(input.totalBytes) || input.totalBytes <= 0) {
    throw new UploadServiceError("invalid_total_bytes", 400);
  }
  if (input.totalBytes > declaration.maxBytes) {
    throw new UploadServiceError("too_large", 413);
  }
  const db = getDb();
  const existing = await db
    .select()
    .from(uploadSession)
    .where(
      and(
        eq(uploadSession.familyId, input.familyId),
        eq(uploadSession.captureId, input.captureId),
      ),
    )
    .limit(1);
  if (existing[0]) {
    if (!sameDeclaration(existing[0], input)) {
      throw new UploadServiceError("capture_id_conflict", 409, existing[0].receivedBytes);
    }
    const recovered = await reconcileUpload(existing[0]);
    return { session: recovered, existing: true };
  }

  const occupiedCapture = await db
    .select({ familyId: inboxItem.familyId })
    .from(inboxItem)
    .where(eq(inboxItem.id, input.captureId))
    .limit(1);
  if (occupiedCapture[0]) {
    // The global inbox primary key may belong to this or another family. The
    // caller receives the same opaque conflict either way.
    throw new UploadServiceError("capture_id_conflict", 409);
  }

  if (input.importSessionId) {
    const parent = await db
      .select()
      .from(importSession)
      .where(
        and(
          eq(importSession.familyId, input.familyId),
          eq(importSession.id, input.importSessionId),
        ),
      )
      .limit(1);
    if (!parent[0]) throw new UploadServiceError("import_session_not_found", 404);
    if (parent[0].status === "completed" || parent[0].status === "cancelled") {
      throw new UploadServiceError("import_session_closed", 409);
    }
  }

  const usage = await db
    .select({
      active: count(),
      bytes: sql<number>`coalesce(sum(${uploadSession.totalBytes}), 0)`,
    })
    .from(uploadSession)
    .where(
      and(
        eq(uploadSession.familyId, input.familyId),
        inArray(uploadSession.status, [...ACTIVE_STATUSES]),
      ),
    );
  if ((usage[0]?.active ?? 0) >= MAX_ACTIVE_UPLOADS_PER_FAMILY) {
    throw new UploadServiceError("too_many_active_uploads", 429);
  }
  if ((usage[0]?.bytes ?? 0) + input.totalBytes > MAX_TEMP_BYTES_PER_FAMILY) {
    throw new UploadServiceError("temporary_storage_quota", 413);
  }

  const id = randomUUID();
  const tempStorageKey = await getAssetStorage().createUploadPart(id);
  const now = new Date();
  try {
    const row = db.transaction((tx) => {
      const created = tx
        .insert(uploadSession)
        .values({
          id,
          familyId: input.familyId,
          userId: input.userId,
          captureId: input.captureId,
          filename: sanitizeDisplayFilename(input.filename),
          declaredMime: declaration.mimeType,
          totalBytes: input.totalBytes,
          receivedBytes: 0,
          lastModified: input.lastModified,
          clientFingerprint: input.clientFingerprint ?? null,
          source: input.source,
          importSessionId: input.importSessionId,
          tempStorageKey,
          status: "created",
          expiresAt: new Date(now.getTime() + UPLOAD_TTL_MS),
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      if (input.importSessionId) {
        const order = tx
          .select({ value: max(importSessionItem.sortOrder) })
          .from(importSessionItem)
          .where(eq(importSessionItem.importSessionId, input.importSessionId))
          .get()?.value;
        tx.insert(importSessionItem)
          .values({
            id: randomUUID(),
            familyId: input.familyId,
            importSessionId: input.importSessionId,
            captureId: input.captureId,
            uploadSessionId: id,
            status: "pending",
            sortOrder: (order ?? -1) + 1,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        tx.update(importSession)
          .set({
            totalCount: sql`${importSession.totalCount} + 1`,
            status: "uploading",
            updatedAt: now,
          })
          .where(eq(importSession.id, input.importSessionId))
          .run();
      }
      return created;
    });
    return { session: row, existing: false };
  } catch (error) {
    await getAssetStorage().deleteUploadPart(tempStorageKey);
    const raced = await db
      .select()
      .from(uploadSession)
      .where(
        and(
          eq(uploadSession.familyId, input.familyId),
          eq(uploadSession.captureId, input.captureId),
        ),
      )
      .limit(1);
    if (raced[0] && sameDeclaration(raced[0], input)) {
      return { session: await reconcileUpload(raced[0]), existing: true };
    }
    throw error;
  }
}

async function sessionForFamily(
  familyId: string,
  uploadId: string,
): Promise<UploadSessionRow> {
  const rows = await getDb()
    .select()
    .from(uploadSession)
    .where(and(eq(uploadSession.familyId, familyId), eq(uploadSession.id, uploadId)))
    .limit(1);
  if (!rows[0]) throw new UploadServiceError("not_found", 404);
  return rows[0];
}

async function reconcileUpload(row: UploadSessionRow): Promise<UploadSessionRow> {
  if (!ACTIVE_STATUSES.includes(row.status as (typeof ACTIVE_STATUSES)[number])) {
    return row;
  }
  let diskBytes: number;
  try {
    diskBytes = await getAssetStorage().uploadPartSize(row.tempStorageKey);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await failUpload(row, "temporary_file_missing");
    throw new UploadServiceError("temporary_file_missing", 409, 0);
  }
  if (diskBytes > row.totalBytes) {
    await failUpload(row, "temporary_file_oversize");
    throw new UploadServiceError("temporary_file_oversize", 409, row.receivedBytes);
  }
  if (diskBytes === row.receivedBytes) return row;
  const updated = await getDb()
    .update(uploadSession)
    .set({ receivedBytes: diskBytes, updatedAt: new Date() })
    .where(eq(uploadSession.id, row.id))
    .returning();
  return updated[0];
}

async function failUpload(row: UploadSessionRow, errorCode: string): Promise<void> {
  const now = new Date();
  getDb().transaction((tx) => {
    tx.update(uploadSession)
      .set({ status: "failed", errorCode, updatedAt: now })
      .where(and(eq(uploadSession.id, row.id), ne(uploadSession.status, "completed")))
      .run();
    const item = tx
      .select({ status: importSessionItem.status })
      .from(importSessionItem)
      .where(eq(importSessionItem.uploadSessionId, row.id))
      .limit(1)
      .get();
    if (item && !["completed", "failed", "cancelled"].includes(item.status)) {
      tx.update(importSessionItem)
        .set({ status: "failed", errorCode, updatedAt: now })
        .where(eq(importSessionItem.uploadSessionId, row.id))
        .run();
      if (row.importSessionId) {
        tx.update(importSession)
          .set({ failedCount: sql`${importSession.failedCount} + 1`, updatedAt: now })
          .where(eq(importSession.id, row.importSessionId))
          .run();
      }
    }
  });
}

async function expireIfNeeded(row: UploadSessionRow): Promise<UploadSessionRow> {
  if (
    ACTIVE_STATUSES.includes(row.status as (typeof ACTIVE_STATUSES)[number]) &&
    row.expiresAt.getTime() <= Date.now()
  ) {
    await expireUpload(row, new Date());
    throw new UploadServiceError("expired", 410, row.receivedBytes);
  }
  return row;
}

export async function getUploadSession(
  familyId: string,
  uploadId: string,
): Promise<UploadSessionRow> {
  return expireIfNeeded(await reconcileUpload(await sessionForFamily(familyId, uploadId)));
}

const uploadLocks = new Map<string, Promise<void>>();

async function withUploadLock<T>(uploadId: string, effect: () => Promise<T>): Promise<T> {
  const previous = uploadLocks.get(uploadId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => gate);
  uploadLocks.set(uploadId, tail);
  await previous;
  try {
    return await effect();
  } finally {
    release();
    if (uploadLocks.get(uploadId) === tail) uploadLocks.delete(uploadId);
  }
}

export async function appendUploadChunk(input: {
  familyId: string;
  uploadId: string;
  offset: number;
  contentLength: number;
  body: Readable;
}): Promise<{ offset: number; replayed: boolean }> {
  return withUploadLock(input.uploadId, async () => {
    const row = await getUploadSession(input.familyId, input.uploadId);
    if (!ACTIVE_STATUSES.includes(row.status as (typeof ACTIVE_STATUSES)[number])) {
      throw new UploadServiceError(
        row.status === "completed" ? "already_completed" : "upload_not_active",
        row.status === "completed" ? 409 : 410,
        row.receivedBytes,
      );
    }
    if (
      !Number.isSafeInteger(input.offset) ||
      input.offset < 0 ||
      !Number.isSafeInteger(input.contentLength) ||
      input.contentLength <= 0
    ) {
      throw new UploadServiceError("invalid_upload_headers", 400, row.receivedBytes);
    }
    if (input.contentLength > RESUMABLE_CHUNK_BYTES) {
      throw new UploadServiceError("chunk_too_large", 413, row.receivedBytes);
    }
    if (input.offset + input.contentLength > row.totalBytes) {
      throw new UploadServiceError("exceeds_declared_size", 413, row.receivedBytes);
    }
    if (input.offset > row.receivedBytes) {
      throw new UploadServiceError("offset_mismatch", 409, row.receivedBytes);
    }
    try {
      const result = await getAssetStorage().appendUploadPart(
        row.tempStorageKey,
        input.offset,
        input.contentLength,
        input.body,
      );
      const now = new Date();
      if (!result.replayed) {
        await getDb().transaction((tx) => {
          tx.update(uploadSession)
            .set({ receivedBytes: result.bytes, status: "uploading", errorCode: null, updatedAt: now })
            .where(eq(uploadSession.id, row.id))
            .run();
          tx.update(importSessionItem)
            .set({ status: "uploading", errorCode: null, updatedAt: now })
            .where(eq(importSessionItem.uploadSessionId, row.id))
            .run();
        });
      }
      return { offset: result.bytes, replayed: result.replayed };
    } catch (error) {
      if (error instanceof UploadReplayMismatchError || error instanceof UploadOffsetError) {
        throw new UploadServiceError("offset_mismatch", 409, error.actualOffset);
      }
      if (error instanceof UploadLengthError) {
        throw new UploadServiceError("content_length_mismatch", 400, row.receivedBytes);
      }
      throw error;
    }
  });
}

async function inspectUpload(row: UploadSessionRow): Promise<{
  sha256: string;
  prefix: Buffer;
  bytes: number;
  safeText: string | null;
  invalidText: boolean;
}> {
  const hash = createHash("sha256");
  const prefixChunks: Buffer[] = [];
  let prefixBytes = 0;
  let bytes = 0;
  const textMime = row.declaredMime === "text/plain" || row.declaredMime === "text/markdown";
  const decoder = textMime ? new TextDecoder("utf-8", { fatal: true }) : null;
  let safeText = "";
  let invalidText = false;
  for await (const value of getAssetStorage().createUploadReadStream(row.tempStorageKey)) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    bytes += chunk.byteLength;
    hash.update(chunk);
    if (decoder) {
      if (chunk.includes(0)) invalidText = true;
      try {
        const decoded = decoder.decode(chunk, { stream: true });
        if (safeText.length < 256 * 1024) {
          safeText += decoded.slice(0, 256 * 1024 - safeText.length);
        }
      } catch {
        invalidText = true;
      }
    }
    if (prefixBytes < VALIDATION_PREFIX_BYTES) {
      const take = Math.min(chunk.byteLength, VALIDATION_PREFIX_BYTES - prefixBytes);
      prefixChunks.push(chunk.subarray(0, take));
      prefixBytes += take;
    }
  }
  if (decoder) {
    try {
      const tail = decoder.decode();
      if (safeText.length < 256 * 1024) safeText += tail.slice(0, 256 * 1024 - safeText.length);
    } catch {
      invalidText = true;
    }
  }
  return {
    sha256: hash.digest("hex"),
    prefix: Buffer.concat(prefixChunks),
    bytes,
    safeText: decoder && !invalidText ? safeText : null,
    invalidText,
  };
}

async function resolveMetadata(
  row: UploadSessionRow,
  type: UploadAssetType,
  mimeType: string,
  prefix: Buffer,
): Promise<{
  capturedAt: Date | null;
  timeSource: TimeSource;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  metadataJson: string | null;
}> {
  const absolutePath = getAssetStorage().resolveUploadPath(row.tempStorageKey);
  let capturedAt: Date | null = null;
  let timeSource: TimeSource = "import_time";
  let width: number | null = null;
  let height: number | null = null;
  let durationMs: number | null = null;
  const metadata: Record<string, unknown> = {};

  if (type === "image") {
    const family = await getFamily(row.familyId);
    const embedded = await extractEmbeddedTimeFromFile(absolutePath);
    if (embedded) {
      capturedAt = embeddedTimeToUtc(embedded, family?.timezone ?? "Asia/Shanghai");
      timeSource = "embedded_metadata";
      metadata.exif = embedded.raw;
    }
    const dimensions = parseImageSize(prefix, mimeType);
    if (dimensions) {
      width = dimensions.width;
      height = dimensions.height;
      metadata.image = dimensions;
    }
  } else if (type === "audio" || type === "video") {
    const probe = await probeMedia(absolutePath);
    if (probe) {
      durationMs = probe.durationMs;
      if (type === "video") {
        width = probe.width;
        height = probe.height;
      }
      if (probe.creationTime) {
        capturedAt = probe.creationTime;
        timeSource = "embedded_metadata";
      }
      metadata.container = {
        formatName: probe.formatName,
        durationMs: probe.durationMs,
        ...(probe.rotation !== null ? { rotation: probe.rotation } : {}),
      };
      if (probe.raw) metadata.ffprobe = probe.raw;
    }
  }
  if (!capturedAt && row.lastModified) {
    capturedAt = row.lastModified;
    timeSource = "file_metadata";
  }
  return {
    capturedAt,
    timeSource,
    width,
    height,
    durationMs,
    metadataJson: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
  };
}

function markImportItemCompleted(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  row: UploadSessionRow,
  assetId: string,
  inboxItemId: string,
  now: Date,
): void {
  if (!row.importSessionId) return;
  const item = tx
    .select({ status: importSessionItem.status })
    .from(importSessionItem)
    .where(eq(importSessionItem.uploadSessionId, row.id))
    .limit(1)
    .get();
  if (!item || item.status === "completed") return;
  tx.update(importSessionItem)
    .set({ status: "completed", assetId, inboxItemId, errorCode: null, updatedAt: now })
    .where(eq(importSessionItem.uploadSessionId, row.id))
    .run();
  tx.update(importSession)
    .set({
      completedCount: sql`${importSession.completedCount} + 1`,
      status: "reviewing",
      updatedAt: now,
    })
    .where(eq(importSession.id, row.importSessionId))
    .run();
}

async function importDefaults(row: UploadSessionRow): Promise<{
  title: string | null;
  occurredAt: Date | null;
  locationText: string | null;
  participantPersonIds: string[];
} | null> {
  if (!row.importSessionId) return null;
  const detail = await getImportSessionDetail(row.familyId, row.importSessionId);
  if (!detail) return null;
  return {
    title: detail.session.defaultTitle,
    occurredAt: detail.session.defaultOccurredAt,
    locationText: detail.session.defaultLocationText,
    participantPersonIds: detail.participantPersonIds,
  };
}

function applyImportDefaults(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  familyId: string,
  inboxItemId: string,
  defaults: Awaited<ReturnType<typeof importDefaults>>,
  now: Date,
): void {
  if (!defaults) return;
  tx.update(inboxItem)
    .set({
      ...(defaults.title ? { draftTitle: defaults.title.slice(0, 100) } : {}),
      ...(defaults.occurredAt ? { draftOccurredAt: defaults.occurredAt } : {}),
      ...(defaults.locationText ? { draftLocationText: defaults.locationText } : {}),
      updatedAt: now,
    })
    .where(and(eq(inboxItem.familyId, familyId), eq(inboxItem.id, inboxItemId)))
    .run();
  if (defaults.participantPersonIds.length > 0) {
    tx.insert(inboxItemParticipant)
      .values(defaults.participantPersonIds.map((personId) => ({
        id: randomUUID(),
        inboxItemId,
        personId,
        familyId,
        createdAt: now,
      })))
      .onConflictDoNothing()
      .run();
  }
}

async function finalizeExisting(
  row: UploadSessionRow,
  existing: AssetRow,
): Promise<CompleteUploadResult> {
  const inbox = createInboxItemForAssetIdempotent(row.familyId, existing, row.captureId);
  if (inbox.status === "conflict") {
    throw new UploadServiceError("capture_id_conflict", 409, row.receivedBytes);
  }
  const now = new Date();
  const defaults = inbox.status === "created" ? await importDefaults(row) : null;
  getDb().transaction((tx) => {
    tx.update(uploadSession)
      .set({
        status: "completed",
        finalAssetId: existing.id,
        finalInboxItemId: inbox.item.id,
        errorCode: null,
        updatedAt: now,
      })
      .where(eq(uploadSession.id, row.id))
      .run();
    markImportItemCompleted(tx, row, existing.id, inbox.item.id, now);
    applyImportDefaults(tx, row.familyId, inbox.item.id, defaults, now);
  });
  await getAssetStorage().deleteUploadPart(row.tempStorageKey);
  return {
    status: "duplicate",
    assetId: existing.id,
    inboxItemId: inbox.item.id,
    sha256: existing.sha256,
    bytes: existing.bytes,
  };
}

export type CompleteUploadResult = {
  status: "stored" | "duplicate";
  assetId: string;
  inboxItemId: string;
  sha256: string;
  bytes: number;
};

async function completedResult(row: UploadSessionRow): Promise<CompleteUploadResult> {
  if (!row.finalAssetId || !row.finalInboxItemId) {
    throw new UploadServiceError("invalid_completed_session", 500, row.receivedBytes);
  }
  const rows = await getDb()
    .select()
    .from(asset)
    .where(and(eq(asset.familyId, row.familyId), eq(asset.id, row.finalAssetId)))
    .limit(1);
  if (!rows[0]) throw new UploadServiceError("invalid_completed_session", 500, row.receivedBytes);
  return {
    status: rows[0].id === row.id ? "stored" : "duplicate",
    assetId: rows[0].id,
    inboxItemId: row.finalInboxItemId,
    sha256: rows[0].sha256,
    bytes: rows[0].bytes,
  };
}

export async function completeUpload(
  familyId: string,
  uploadId: string,
): Promise<CompleteUploadResult> {
  return withUploadLock(uploadId, async () => {
    const row = await getUploadSession(familyId, uploadId);
    if (row.status === "completed") {
      await getAssetStorage().deleteUploadPart(row.tempStorageKey);
      return completedResult(row);
    }
    if (!ACTIVE_STATUSES.includes(row.status as (typeof ACTIVE_STATUSES)[number])) {
      throw new UploadServiceError("upload_not_active", 410, row.receivedBytes);
    }
    if (row.receivedBytes !== row.totalBytes) {
      throw new UploadServiceError("upload_incomplete", 409, row.receivedBytes);
    }

    const inspected = await inspectUpload(row);
    if (inspected.bytes !== row.totalBytes) {
      const recovered = await reconcileUpload(row);
      throw new UploadServiceError("upload_incomplete", 409, recovered.receivedBytes);
    }
    const validation = validateUploadPrefix(
      inspected.prefix,
      row.declaredMime,
      inspected.bytes,
    );
    if (!validation.ok) {
      await failUpload(row, validation.error);
      throw new UploadServiceError(validation.error, 415, row.receivedBytes);
    }
    if (inspected.invalidText) {
      await failUpload(row, "content_mismatch");
      throw new UploadServiceError("content_mismatch", 415, row.receivedBytes);
    }
    const existing = await findOriginalBySha256(row.familyId, inspected.sha256);
    if (existing) return finalizeExisting(row, existing);

    const metadata = await resolveMetadata(
      row,
      validation.value.type,
      validation.value.mimeType,
      inspected.prefix,
    );
    const assetId = row.id; // deterministic: a crash between link and commit is recoverable
    const importedAt = new Date();
    const dateForPath = metadata.capturedAt ?? row.createdAt;
    let storageKey: string;
    try {
      storageKey = (
        await getAssetStorage().promoteUploadPart(
          row.tempStorageKey,
          row.familyId,
          assetId,
          validation.value.extension,
          dateForPath,
        )
      ).storageKey;
    } catch (error) {
      if (!(error instanceof OriginalExistsError)) throw error;
      const expected = buildOriginalStorageKey(
        row.familyId,
        assetId,
        validation.value.extension,
        dateForPath,
      );
      const [sourceInfo, targetInfo] = await Promise.all([
        lstat(getAssetStorage().resolveUploadPath(row.tempStorageKey)),
        lstat(getAssetStorage().resolvePath(expected)),
      ]);
      if (sourceInfo.dev !== targetInfo.dev || sourceInfo.ino !== targetInfo.ino) throw error;
      storageKey = expected;
    }

    const now = new Date();
    const defaults = await importDefaults(row);
    try {
      const stored = getDb().transaction((tx) => {
        const assetRow = tx
          .insert(asset)
          .values({
            id: assetId,
            familyId: row.familyId,
            type: validation.value.type,
            originalFilename: row.filename,
            mimeType: validation.value.mimeType,
            bytes: inspected.bytes,
            sha256: inspected.sha256,
            storageKey,
            capturedAt: metadata.capturedAt,
            importedAt,
            timeSource: metadata.timeSource,
            width: metadata.width,
            height: metadata.height,
            durationMs: metadata.durationMs,
            metadataJson: metadata.metadataJson,
            createdByUserId: row.userId!,
            originalAssetId: null,
            derivativeType: null,
            createdAt: now,
          })
          .returning()
          .get();
        const item = tx
          .insert(inboxItem)
          .values({
            id: row.captureId,
            familyId: row.familyId,
            kind: "asset",
            status: metadata.timeSource === "import_time" ? "needs_review" : "new",
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        tx.insert(inboxItemAsset)
          .values({
            id: randomUUID(),
            inboxItemId: item.id,
            assetId: assetRow.id,
            familyId: row.familyId,
            createdAt: now,
          })
          .run();
        if (
          validation.value.type === "document" &&
          inspected.safeText !== null
        ) {
          tx.insert(documentText)
            .values({
              id: randomUUID(),
              familyId: row.familyId,
              assetId: assetRow.id,
              text: inspected.safeText,
              truncated: inspected.bytes > Buffer.byteLength(inspected.safeText, "utf8"),
              createdAt: now,
            })
            .run();
        }
        applyImportDefaults(tx, row.familyId, item.id, defaults, now);
        tx.update(uploadSession)
          .set({
            status: "completed",
            finalAssetId: assetRow.id,
            finalInboxItemId: item.id,
            errorCode: null,
            updatedAt: now,
          })
          .where(eq(uploadSession.id, row.id))
          .run();
        markImportItemCompleted(tx, row, assetRow.id, item.id, now);
        return { assetRow, item };
      });
      await getAssetStorage().deleteUploadPart(row.tempStorageKey);
      return {
        status: "stored",
        assetId: stored.assetRow.id,
        inboxItemId: stored.item.id,
        sha256: stored.assetRow.sha256,
        bytes: stored.assetRow.bytes,
      };
    } catch (error) {
      getAssetStorage().delete(storageKey);
      const raced = await findOriginalBySha256(row.familyId, inspected.sha256);
      if (raced) return finalizeExisting(row, raced);
      throw error;
    }
  });
}

export async function cancelUpload(
  familyId: string,
  uploadId: string,
): Promise<UploadSessionRow> {
  return withUploadLock(uploadId, async () => {
    const row = await sessionForFamily(familyId, uploadId);
    if (row.status === "completed" || row.status === "cancelled") return row;
    await getAssetStorage().deleteUploadPart(row.tempStorageKey);
    const now = new Date();
    return getDb().transaction((tx) => {
      const updated = tx
        .update(uploadSession)
        .set({ status: "cancelled", errorCode: null, updatedAt: now })
        .where(eq(uploadSession.id, row.id))
        .returning()
        .get();
      tx.update(importSessionItem)
        .set({ status: "cancelled", updatedAt: now })
        .where(
          and(
            eq(importSessionItem.uploadSessionId, row.id),
            ne(importSessionItem.status, "completed"),
          ),
        )
        .run();
      return updated;
    });
  });
}

async function expireUpload(row: UploadSessionRow, now: Date): Promise<void> {
  if (row.status === "completed") return;
  await getAssetStorage().deleteUploadPart(row.tempStorageKey);
  getDb().transaction((tx) => {
    tx.update(uploadSession)
      .set({ status: "expired", errorCode: "expired", updatedAt: now })
      .where(and(eq(uploadSession.id, row.id), ne(uploadSession.status, "completed")))
      .run();
    const item = tx
      .select({ status: importSessionItem.status })
      .from(importSessionItem)
      .where(eq(importSessionItem.uploadSessionId, row.id))
      .limit(1)
      .get();
    if (item && !["completed", "failed", "cancelled"].includes(item.status)) {
      tx.update(importSessionItem)
        .set({ status: "failed", errorCode: "expired", updatedAt: now })
        .where(eq(importSessionItem.uploadSessionId, row.id))
        .run();
      if (row.importSessionId) {
        tx.update(importSession)
          .set({ failedCount: sql`${importSession.failedCount} + 1`, updatedAt: now })
          .where(eq(importSession.id, row.importSessionId))
          .run();
      }
    }
  });
}

/** Bounded worker sweep. Completed originals are excluded before touching disk. */
export async function cleanupExpiredUploads(
  options: { now?: Date; limit?: number } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const rows = await getDb()
    .select()
    .from(uploadSession)
    .where(
      and(
        inArray(uploadSession.status, ["created", "uploading", "failed"]),
        lt(uploadSession.expiresAt, now),
      ),
    )
    .limit(limit);
  for (const row of rows) {
    await withUploadLock(row.id, () => expireUpload(row, now));
  }
  return rows.length;
}

export type ImportSessionDetail = {
  session: ImportSessionRow;
  participantPersonIds: string[];
  items: Array<{
    item: typeof importSessionItem.$inferSelect;
    upload: UploadSessionRow | null;
  }>;
};

export async function getImportSessionDetail(
  familyId: string,
  importId: string,
): Promise<ImportSessionDetail | null> {
  const db = getDb();
  const sessions = await db
    .select()
    .from(importSession)
    .where(and(eq(importSession.familyId, familyId), eq(importSession.id, importId)))
    .limit(1);
  if (!sessions[0]) return null;
  const [rows, participants] = await Promise.all([
    db
      .select({ item: importSessionItem, upload: uploadSession })
      .from(importSessionItem)
      .leftJoin(uploadSession, eq(uploadSession.id, importSessionItem.uploadSessionId))
      .where(
        and(
          eq(importSessionItem.familyId, familyId),
          eq(importSessionItem.importSessionId, importId),
        ),
      )
      .orderBy(asc(importSessionItem.sortOrder)),
    db
      .select({ personId: importSessionDefaultParticipant.personId })
      .from(importSessionDefaultParticipant)
      .where(
        and(
          eq(importSessionDefaultParticipant.familyId, familyId),
          eq(importSessionDefaultParticipant.importSessionId, importId),
        ),
      ),
  ]);
  return {
    session: sessions[0],
    participantPersonIds: participants.map((row) => row.personId),
    items: rows,
  };
}

type ImportCursor = { createdAtMs: number; id: string };

function decodeImportCursor(cursor: string | null | undefined): ImportCursor | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as ImportCursor;
    return Number.isSafeInteger(value.createdAtMs) && UUID_PATTERN.test(value.id) ? value : null;
  } catch {
    return null;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function listImportSessions(
  familyId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<{ sessions: ImportSessionRow[]; nextCursor: string | null }> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
  const cursor = decodeImportCursor(options.cursor);
  const rows = await getDb()
    .select()
    .from(importSession)
    .where(
      cursor
        ? and(
            eq(importSession.familyId, familyId),
            or(
              lt(importSession.createdAt, new Date(cursor.createdAtMs)),
              and(
                eq(importSession.createdAt, new Date(cursor.createdAtMs)),
                lt(importSession.id, cursor.id),
              ),
            ),
          )
        : eq(importSession.familyId, familyId),
    )
    .orderBy(desc(importSession.createdAt), desc(importSession.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const sessions = rows.slice(0, limit);
  const last = sessions.at(-1);
  return {
    sessions,
    nextCursor: hasMore && last
      ? Buffer.from(JSON.stringify({ createdAtMs: last.createdAt.getTime(), id: last.id })).toString("base64url")
      : null,
  };
}

export async function setImportSessionUploading(
  familyId: string,
  importId: string,
  uploading: boolean,
): Promise<ImportSessionRow> {
  const current = await getImportSessionDetail(familyId, importId);
  if (!current) throw new UploadServiceError("not_found", 404);
  if (["completed", "cancelled"].includes(current.session.status)) {
    throw new UploadServiceError("import_session_closed", 409);
  }
  return getDb()
    .update(importSession)
    .set({ status: uploading ? "uploading" : "collecting", updatedAt: new Date() })
    .where(and(eq(importSession.familyId, familyId), eq(importSession.id, importId)))
    .returning()
    .get();
}

export async function cancelImportSession(
  familyId: string,
  importId: string,
): Promise<ImportSessionRow> {
  const detail = await getImportSessionDetail(familyId, importId);
  if (!detail) throw new UploadServiceError("not_found", 404);
  if (detail.session.status === "completed") return detail.session;
  const now = new Date();
  const cancelled = getDb()
    .update(importSession)
    .set({ status: "cancelled", updatedAt: now })
    .where(and(eq(importSession.familyId, familyId), eq(importSession.id, importId)))
    .returning()
    .get();
  for (const row of detail.items) {
    if (row.upload && row.item.status !== "completed") {
      await cancelUpload(familyId, row.upload.id);
    }
  }
  return cancelled;
}

export async function restartUpload(
  familyId: string,
  uploadId: string,
): Promise<UploadSessionRow> {
  return withUploadLock(uploadId, async () => {
    const row = await sessionForFamily(familyId, uploadId);
    if (row.status === "completed") return row;
    if (ACTIVE_STATUSES.includes(row.status as (typeof ACTIVE_STATUSES)[number])) {
      return reconcileUpload(row);
    }
    if (row.importSessionId) {
      const parent = await getImportSessionDetail(familyId, row.importSessionId);
      if (!parent || parent.session.status === "cancelled" || parent.session.status === "completed") {
        throw new UploadServiceError("import_session_closed", 409);
      }
    }
    await getAssetStorage().deleteUploadPart(row.tempStorageKey);
    const key = await getAssetStorage().createUploadPart(row.id);
    if (key !== row.tempStorageKey) throw new UploadServiceError("temporary_storage_error", 500);
    const now = new Date();
    return getDb().transaction((tx) => {
      const updated = tx
        .update(uploadSession)
        .set({
          status: "created",
          receivedBytes: 0,
          errorCode: null,
          expiresAt: new Date(now.getTime() + UPLOAD_TTL_MS),
          updatedAt: now,
        })
        .where(eq(uploadSession.id, row.id))
        .returning()
        .get();
      const item = tx
        .select({ status: importSessionItem.status })
        .from(importSessionItem)
        .where(eq(importSessionItem.uploadSessionId, row.id))
        .limit(1)
        .get();
      if (item && item.status !== "completed") {
        tx.update(importSessionItem)
          .set({ status: "pending", errorCode: null, updatedAt: now })
          .where(eq(importSessionItem.uploadSessionId, row.id))
          .run();
        if (item.status === "failed" && row.importSessionId) {
          tx.update(importSession)
            .set({ failedCount: sql`max(0, ${importSession.failedCount} - 1)`, updatedAt: now })
            .where(eq(importSession.id, row.importSessionId))
            .run();
        }
      }
      return updated;
    });
  });
}
