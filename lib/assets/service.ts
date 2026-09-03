import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { asset } from "@/db/schema/asset";
import {
  getAssetStorage,
  type DerivativeType,
} from "./storage";

/**
 * Asset 领域服务（Issue #004）。
 * 原件写入流程：hash → 查重 → putOriginal（不可覆盖）→ DB 行。
 * 所有查询强制带 familyId（隔离边界）。
 */

export type AssetType = "image" | "video" | "audio" | "document";

export type TimeSource =
  | "user_confirmed"
  | "embedded_metadata"
  | "file_metadata"
  | "import_time";

export type StoreOriginalInput = {
  familyId: string;
  createdByUserId: string;
  type: AssetType;
  originalFilename: string; // 仅展示，可含任意字符
  mimeType: string;
  buffer: Buffer;
  extension: string; // 已由调用方按 MIME 白名单归一
  capturedAt?: Date | null;
  timeSource: TimeSource;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  metadataJson?: unknown;
};

export type DuplicateFound = {
  status: "duplicate";
  existing: AssetRow;
};

export type Stored = {
  status: "stored";
  asset: AssetRow;
};

export type StoreOriginalResult = Stored | DuplicateFound;

export type AssetRow = typeof asset.$inferSelect;

export function sha256Of(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** 家庭内按 SHA-256 精确查重（只对原件；衍生物不参与） */
export async function findOriginalBySha256(
  familyId: string,
  sha256: string,
): Promise<AssetRow | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(asset)
    .where(
      and(
        eq(asset.familyId, familyId),
        eq(asset.sha256, sha256),
        isNull(asset.originalAssetId),
      ),
    )
    .orderBy(desc(asset.createdAt))
    .limit(1);
  return rows[0];
}

export async function getAsset(
  familyId: string,
  assetId: string,
): Promise<AssetRow | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(asset)
    .where(and(eq(asset.familyId, familyId), eq(asset.id, assetId)))
    .limit(1);
  return rows[0];
}

export async function listAssets(
  familyId: string,
  limit = 100,
): Promise<AssetRow[]> {
  const db = getDb();
  return db
    .select()
    .from(asset)
    .where(eq(asset.familyId, familyId))
    .orderBy(desc(asset.createdAt))
    .limit(limit);
}

/**
 * 保存原件。家庭内相同 SHA-256 已存在时不写盘、不入库，返回 duplicate，
 * 由上层 UI 明确提示（PRD §12：系统只提示，不静默复制）。
 */
export async function storeOriginal(
  input: StoreOriginalInput,
): Promise<StoreOriginalResult> {
  const sha256 = sha256Of(input.buffer);
  const existing = await findOriginalBySha256(input.familyId, sha256);
  if (existing) return { status: "duplicate", existing: existing };

  const storage = getAssetStorage();
  const assetId = randomUUID();
  const importedAt = new Date();
  // 目录用 capturedAt 的年月（真实发生时间），缺失时退回导入年月
  const dateForPath = input.capturedAt ?? importedAt;
  const { storageKey } = storage.putOriginal(
    input.familyId,
    assetId,
    input.extension,
    input.buffer,
    dateForPath,
  );

  const db = getDb();
  try {
    const rows = await db
      .insert(asset)
      .values({
        id: assetId,
        familyId: input.familyId,
        type: input.type,
        originalFilename: sanitizeDisplayFilename(input.originalFilename),
        mimeType: input.mimeType,
        bytes: input.buffer.byteLength,
        sha256,
        storageKey,
        capturedAt: input.capturedAt ?? null,
        importedAt,
        timeSource: input.timeSource,
        width: input.width ?? null,
        height: input.height ?? null,
        durationMs: input.durationMs ?? null,
        metadataJson:
          input.metadataJson === undefined
            ? null
            : JSON.stringify(input.metadataJson),
        createdByUserId: input.createdByUserId,
        originalAssetId: null,
        derivativeType: null,
        createdAt: new Date(),
      })
      .returning();
    return { status: "stored", asset: rows[0] };
  } catch (error) {
    // 文件先于 DB 行落盘；任何 DB 失败都必须回收本次唯一 assetId 对应的文件。
    storage.delete(storageKey);
    const code = (error as { code?: string }).code ?? "";
    if (code.startsWith("SQLITE_CONSTRAINT_UNIQUE")) {
      // 并发相同上传：另一请求已成为 canonical，当前请求按正常 duplicate 返回。
      const canonical = await findOriginalBySha256(input.familyId, sha256);
      if (canonical) return { status: "duplicate", existing: canonical };
    }
    throw error;
  }
}

/** 保存衍生物（缩略图/预览/转码/波形），不影响原件 */
export async function storeDerivative(
  familyId: string,
  originalAssetId: string,
  derivativeType: DerivativeType,
  opts: {
    mimeType: string;
    extension: string;
    buffer: Buffer;
    metadataJson?: unknown;
  },
): Promise<AssetRow | undefined> {
  const original = await getAsset(familyId, originalAssetId);
  if (!original) return undefined;
  const storage = getAssetStorage();
  const derivativeId = randomUUID();
  const dateForPath = original.capturedAt ?? original.importedAt;
  const { storageKey } = storage.putDerivative(
    derivativeType,
    familyId,
    derivativeId,
    opts.extension,
    opts.buffer,
    dateForPath,
  );
  const db = getDb();
  try {
    const rows = await db
      .insert(asset)
      .values({
        id: derivativeId,
        familyId,
        type: original.type,
        originalFilename: `${derivativeType}-${original.originalFilename}`,
        mimeType: opts.mimeType,
        bytes: opts.buffer.byteLength,
        sha256: sha256Of(opts.buffer),
        storageKey,
        capturedAt: original.capturedAt,
        importedAt: new Date(),
        timeSource: original.timeSource,
        metadataJson:
          opts.metadataJson === undefined
            ? null
            : JSON.stringify(opts.metadataJson),
        createdByUserId: original.createdByUserId,
        originalAssetId,
        derivativeType,
        createdAt: new Date(),
      })
      .returning();
    return rows[0];
  } catch (error) {
    storage.delete(storageKey);
    throw error;
  }
}

/** 展示名清洗：去掉路径分隔符与控制字符，限制长度 */
export function sanitizeDisplayFilename(filename: string): string {
  const base = filename.replaceAll(/[\\/]/g, "-").replaceAll(/[\x00-\x1f]/g, "");
  const trimmed = base.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 200) : "unnamed";
}

/**
 * 批量取缩略图（v0.1.3）：originalAssetId → thumbnail 衍生物行。
 * 展示层用它避免在时间轴/收件箱加载全尺寸原件。
 * 同一原件存在多个衍生物时取最新（createdAt 降序第一条）。
 */
export async function getThumbnailMap(
  familyId: string,
  originalAssetIds: string[],
): Promise<Map<string, AssetRow>> {
  const map = new Map<string, AssetRow>();
  if (originalAssetIds.length === 0) return map;
  const db = getDb();
  const rows = await db
    .select()
    .from(asset)
    .where(
      and(
        eq(asset.familyId, familyId),
        eq(asset.derivativeType, "thumbnail"),
        inArray(asset.originalAssetId, originalAssetIds),
      ),
    )
    .orderBy(desc(asset.createdAt));
  for (const row of rows) {
    const key = row.originalAssetId!;
    if (!map.has(key)) map.set(key, row); // 第一条即最新
  }
  return map;
}
