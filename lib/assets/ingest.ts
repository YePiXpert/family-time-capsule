import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { asset } from "@/db/schema/asset";
import {
  parseImageSize,
  validateImageUpload,
  type UploadValidationFailure,
} from "./validation";
import { storeOriginal, type AssetRow } from "./service";

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

export async function ingestImage(
  input: IngestImageInput,
): Promise<IngestImageResult> {
  const validated = validateImageUpload(input.buffer, input.declaredMime);
  if (!validated.ok) return { status: "rejected", error: validated.error };
  const { mimeType, extension } = validated.value;

  // capturedAt 优先级：EXIF（#006）> 文件系统时间 > 导入时间。
  // 时间解释依赖家庭时区（DECISIONS D-009）。
  const resolved = resolveCaptureTime(input.clientLastModifiedMs ?? null);

  const dimensions = parseImageSize(input.buffer, mimeType);

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
    metadataJson: dimensions ? { image: dimensions } : undefined,
  });
}

export type ResolvedCaptureTime = {
  capturedAt: Date | null;
  timeSource: "embedded_metadata" | "file_metadata" | "import_time";
};

/**
 * #005 阶段的 capturedAt 解析：文件系统时间（客户端 lastModified）→ null（导入时兜底）。
 * #006 在最前面插入 EXIF 解析（DateTimeOriginal + 家庭时区解释）。
 */
export function resolveCaptureTime(
  clientLastModifiedMs: number | null,
): ResolvedCaptureTime {
  if (
    clientLastModifiedMs !== null &&
    Number.isFinite(clientLastModifiedMs) &&
    clientLastModifiedMs > 0
  ) {
    return {
      capturedAt: new Date(clientLastModifiedMs),
      timeSource: "file_metadata",
    };
  }
  return { capturedAt: null, timeSource: "import_time" };
}

/** 不带 family 过滤取 Asset（媒体端点先取行再比对 familyId，避免 IDOR 信息泄露） */
export async function getAssetByIdUnchecked(
  assetId: string,
): Promise<AssetRow | undefined> {
  const db = getDb();
  const rows = await db.select().from(asset).where(eq(asset.id, assetId)).limit(1);
  return rows[0];
}
