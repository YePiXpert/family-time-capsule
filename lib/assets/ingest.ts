import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { asset } from "@/db/schema/asset";
import { getFamily } from "@/lib/family/service";
import {
  embeddedTimeToUtc,
  extractEmbeddedTime,
} from "@/lib/metadata/time";
import {
  parseImageSize,
  validateImageUpload,
  validateMediaUpload,
  type UploadValidationFailure,
} from "./validation";
import { probeMedia } from "@/lib/metadata/ffprobe";
import { getAssetStorage } from "./storage";
import {
  sanitizeDisplayFilename,
  sha256Of,
  storeOriginal,
  type AssetRow,
} from "./service";

/**
 * 图片摄取入口（Issue #005）。
 * 流程：size/MIME/魔数校验 → capturedAt 解析（EXIF #006 接入）→ SHA-256 查重
 * → putOriginal → Asset 行。结果交 UI 呈现（重复明确提示，不静默复制）。
 */

export type IngestImageInput = {
  familyId: string;
  createdByUserId: string;
  filename: string;
  declaredMime: string;
  buffer: Buffer;
  /** 浏览器 File.lastModified（文件系统时间），作为 file_metadata 级 fallback */
  clientLastModifiedMs?: number | null;
};

export type IngestImageResult =
  | { status: "stored"; asset: AssetRow }
  | { status: "duplicate"; existing: AssetRow }
  | { status: "rejected"; error: UploadValidationFailure };

export type IngestMediaInput = {
  familyId: string;
  createdByUserId: string;
  kind: "audio" | "video";
  filename: string;
  declaredMime: string;
  buffer: Buffer;
  clientLastModifiedMs?: number | null;
};

export type IngestMediaResult = IngestImageResult;

/**
 * 音频/视频摄取（Issue #011）。
 * 校验 → 先落盘原件（临时日期分层）→ ffprobe 增强 metadata（缺失则跳过）
 * → 更新 capturedAt/duration/尺寸 → 入库。
 * 原件永远保留；浏览器不兼容格式由 P1 的 transcode 衍生物解决。
 */
export async function ingestMedia(input: IngestMediaInput): Promise<IngestMediaResult> {
  const validated = validateMediaUpload(input.buffer, input.declaredMime, input.kind);
  if (!validated.ok) return { status: "rejected", error: validated.error };
  const { mimeType, extension } = validated.value;

  const family = await getFamily(input.familyId);
  const familyTimezone = family?.timezone ?? "Asia/Shanghai";
  void familyTimezone; // 音视频容器时间（creation_time）自带 UTC，无需时区解释

  // 先查重（SHA-256），重复则不落盘
  const sha256 = sha256Of(input.buffer);
  const { findOriginalBySha256 } = await import("./service");
  const existing = await findOriginalBySha256(input.familyId, sha256);
  if (existing) return { status: "duplicate", existing };

  const storage = getAssetStorage();
  const assetId = randomUUID();
  const importedAt = new Date();
  const clientModified =
    input.clientLastModifiedMs && Number.isFinite(input.clientLastModifiedMs)
      ? new Date(input.clientLastModifiedMs)
      : null;
  const dateForPath = clientModified ?? importedAt;
  const { storageKey } = storage.putOriginal(
    input.familyId,
    assetId,
    extension,
    input.buffer,
    dateForPath,
  );

  // ffprobe 增强（缺失/失败 → null，不影响上传）
  const absPath = storage.resolvePath(storageKey);
  const probe = await probeMedia(absPath);

  let capturedAt: Date | null = null;
  let timeSource: "embedded_metadata" | "file_metadata" | "import_time" =
    "import_time";
  if (probe?.creationTime) {
    capturedAt = probe.creationTime;
    timeSource = "embedded_metadata";
  } else if (clientModified) {
    capturedAt = clientModified;
    timeSource = "file_metadata";
  }

  const db = getDb();
  const metadata: Record<string, unknown> = {};
  if (probe) {
    metadata.container = {
      formatName: probe.formatName,
      durationMs: probe.durationMs,
    };
    if (probe.raw) metadata.ffprobe = probe.raw;
  }

  const rows = await db
    .insert(asset)
    .values({
      id: assetId,
      familyId: input.familyId,
      type: input.kind,
      originalFilename: sanitizeDisplayFilename(input.filename),
      mimeType,
      bytes: input.buffer.byteLength,
      sha256,
      storageKey,
      capturedAt,
      importedAt,
      timeSource,
      width: input.kind === "video" ? (probe?.width ?? null) : null,
      height: input.kind === "video" ? (probe?.height ?? null) : null,
      durationMs: probe?.durationMs ?? null,
      metadataJson: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
      createdByUserId: input.createdByUserId,
      originalAssetId: null,
      derivativeType: null,
      createdAt: new Date(),
    })
    .returning();
  return { status: "stored", asset: rows[0] };
}

export async function ingestImage(
  input: IngestImageInput,
): Promise<IngestImageResult> {
  const validated = validateImageUpload(input.buffer, input.declaredMime);
  if (!validated.ok) return { status: "rejected", error: validated.error };
  const { mimeType, extension } = validated.value;

  // capturedAt 优先级：EXIF > 文件系统时间 > 导入时间（家庭时区解释见 D-009）
  const family = await getFamily(input.familyId);
  const familyTimezone = family?.timezone ?? "Asia/Shanghai";
  const { resolved, exif } = await resolveCaptureTime(
    input.buffer,
    mimeType,
    input.clientLastModifiedMs ?? null,
    familyTimezone,
  );

  const dimensions = parseImageSize(input.buffer, mimeType);
  // EXIF 原始字段完整归档（只增不改）；尺寸也是 metadata 的一部分
  const metadata: Record<string, unknown> = {};
  if (exif) metadata.exif = exif.raw;
  if (dimensions) metadata.image = dimensions;

  return storeOriginal({
    familyId: input.familyId,
    createdByUserId: input.createdByUserId,
    type: "image",
    originalFilename: input.filename,
    mimeType,
    buffer: input.buffer,
    extension,
    capturedAt: resolved.capturedAt,
    timeSource: resolved.timeSource,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    metadataJson: Object.keys(metadata).length > 0 ? metadata : undefined,
  });
}

export type ResolvedCaptureTime = {
  capturedAt: Date | null;
  timeSource: "embedded_metadata" | "file_metadata" | "import_time";
};

/**
 * capturedAt 优先级（PRD §1.2）：EXIF（DateTimeOriginal > CreateDate）
 * > 文件系统时间（客户端 lastModified，本身是 UTC 毫秒）
 * > null（导入时间兜底，由 storeOriginal 填 importedAt 场景）。
 * EXIF 无偏移时按家庭时区解释（DECISIONS D-009），绝不凭空假设 UTC。
 */
export async function resolveCaptureTime(
  buffer: Buffer,
  mimeType: string,
  clientLastModifiedMs: number | null,
  familyTimezone: string,
): Promise<{ resolved: ResolvedCaptureTime; exif: Awaited<ReturnType<typeof extractEmbeddedTime>> }> {
  if (mimeType === "image/jpeg" || mimeType === "image/heic" || mimeType === "image/heif" || mimeType === "image/tiff" || mimeType === "image/webp" || mimeType === "image/png") {
    const embedded = await extractEmbeddedTime(buffer);
    if (embedded) {
      return {
        resolved: {
          capturedAt: embeddedTimeToUtc(embedded, familyTimezone),
          timeSource: "embedded_metadata",
        },
        exif: embedded,
      };
    }
  }
  if (
    clientLastModifiedMs !== null &&
    Number.isFinite(clientLastModifiedMs) &&
    clientLastModifiedMs > 0
  ) {
    return {
      resolved: {
        capturedAt: new Date(clientLastModifiedMs),
        timeSource: "file_metadata",
      },
      exif: null,
    };
  }
  return { resolved: { capturedAt: null, timeSource: "import_time" }, exif: null };
}

/**
 * 用户修正真实时间（#006）：timeSource 升级为 user_confirmed。
 * 原始 metadata（EXIF 快照）原样保留，绝不删除。
 */
export async function updateAssetCapturedAt(
  familyId: string,
  assetId: string,
  capturedAt: Date,
): Promise<AssetRow | undefined> {
  const db = getDb();
  const rows = await db
    .update(asset)
    .set({ capturedAt, timeSource: "user_confirmed" })
    .where(and(eq(asset.familyId, familyId), eq(asset.id, assetId)))
    .returning();
  return rows[0];
}

/** 不带 family 过滤取 Asset（媒体端点先取行再比对 familyId，避免 IDOR 信息泄露） */
export async function getAssetByIdUnchecked(
  assetId: string,
): Promise<AssetRow | undefined> {
  const db = getDb();
  const rows = await db.select().from(asset).where(eq(asset.id, assetId)).limit(1);
  return rows[0];
}
