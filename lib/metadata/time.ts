import { zonedWallTimeToUtc, parseOffsetMinutes } from "@/mobile/src/utils/wall-time";
export { zonedWallTimeToUtc, utcToZonedWallTimeInput, parseOffsetMinutes } from "@/mobile/src/utils/wall-time";
import { parse as parseExif } from "exifr";

/**
 * 媒体内嵌时间提取（Issue #006，PRD §1.2）。
 *
 * 优先级：DateTimeOriginal > CreateDate（EXIF）> 文件系统时间 > 导入时间。
 * 时区策略（DECISIONS D-009）：
 * - EXIF 自带 OffsetTimeOriginal/OffsetTime → 直接按该偏移折算 UTC；
 * - 无偏移 → 按「拍摄地本地时间」解释，用 Family timezone 折算 UTC；
 *   绝不凭空假设 UTC。
 * 用户事后修正时间 → timeSource=user_confirmed（#007 收件箱 UI 提供入口）。
 * 原始 metadata 永不删除：EXIF 快照完整存入 Asset.metadataJson。
 */

const EXIF_DATETIME = /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/;

export type EmbeddedTime = {
  /** 本地墙钟时间字符串 YYYY-MM-DDTHH:mm:ss */
  wallTime: string;
  /** 形如 +08:00 / -05:00 的原始偏移；null 表示 EXIF 未提供 */
  offset: string | null;
  /** 原始 EXIF 字段值（存档用） */
  raw: {
    DateTimeOriginal?: string;
    CreateDate?: string;
    OffsetTimeOriginal?: string;
    OffsetTime?: string;
  };
  sourceTag: "DateTimeOriginal" | "CreateDate";
};

const EXIF_PICK = [
  "DateTimeOriginal",
  "CreateDate",
  "OffsetTimeOriginal",
  "OffsetTime",
] as const;

/** 从图片字节中提取内嵌拍摄时间；无 EXIF 或格式异常返回 null（不抛错） */
async function extractEmbeddedTimeFromSource(
  source: Buffer | string,
): Promise<EmbeddedTime | null> {
  let tags: Record<string, unknown> | undefined;
  try {
    tags = await parseExif(source, {
      pick: [...EXIF_PICK],
      reviveValues: false, // 保持原始字符串，时区解释由我们控制
      tiff: true,
      exif: true,
    });
  } catch {
    return null;
  }
  if (!tags) return null;

  const raw: EmbeddedTime["raw"] = {};
  for (const key of EXIF_PICK) {
    const v = tags[key];
    if (typeof v === "string" && v.length > 0) raw[key] = v;
  }

  const primary =
    raw.DateTimeOriginal !== undefined && EXIF_DATETIME.test(raw.DateTimeOriginal)
      ? ("DateTimeOriginal" as const)
      : raw.CreateDate !== undefined && EXIF_DATETIME.test(raw.CreateDate)
        ? ("CreateDate" as const)
        : null;
  if (!primary) return null;

  const value = raw[primary]!;
  const wallTime = `${value.slice(0, 4)}-${value.slice(5, 7)}-${value.slice(8, 10)}T${value.slice(11, 13)}:${value.slice(14, 16)}:${value.slice(17, 19)}`;
  const offset = raw.OffsetTimeOriginal ?? raw.OffsetTime ?? null;
  if (offset !== null && !/^[+-]\d{2}:\d{2}$/.test(offset)) {
    return { wallTime, offset: null, raw, sourceTag: primary };
  }
  return { wallTime, offset, raw, sourceTag: primary };
}

export async function extractEmbeddedTime(
  buffer: Buffer,
): Promise<EmbeddedTime | null> {
  return extractEmbeddedTimeFromSource(buffer);
}

/** exifr performs ranged file reads, so resumable finalize never buffers the image. */
export async function extractEmbeddedTimeFromFile(
  absolutePath: string,
): Promise<EmbeddedTime | null> {
  return extractEmbeddedTimeFromSource(absolutePath);
}

/**
 * 内嵌时间 → UTC。有显式偏移用偏移；无偏移按 familyTimezone 解释。
 */
export function embeddedTimeToUtc(
  embedded: EmbeddedTime,
  familyTimezone: string,
): Date {
  if (embedded.offset) {
    const minutes = parseOffsetMinutes(embedded.offset);
    if (minutes !== null) {
      const asUtc = new Date(`${embedded.wallTime}Z`);
      return new Date(asUtc.getTime() - minutes * 60_000);
    }
  }
  return zonedWallTimeToUtc(embedded.wallTime, familyTimezone);
}
