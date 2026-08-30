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
export async function extractEmbeddedTime(
  buffer: Buffer,
): Promise<EmbeddedTime | null> {
  let tags: Record<string, unknown> | undefined;
  try {
    tags = await parseExif(buffer, {
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

const OFFSET_CACHE = new Map<string, number>();

/** 某一时刻（UTC ms）在指定 IANA 时区的偏移（毫秒） */
function timezoneOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  });
  const part = dtf.formatToParts(instant).find((p) => p.type === "timeZoneName");
  const name = part?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0; // "GMT" 无偏移
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
}

/**
 * 把「时区内的墙钟时间」折算成 UTC 时刻（两遍法处理 DST 边界）：
 * 先把墙钟当作 UTC 求出该时区当时的偏移，再减回偏移。
 */
export function zonedWallTimeToUtc(
  wallTime: string, // YYYY-MM-DDTHH:mm:ss
  timeZone: string,
): Date {
  const asUtc = new Date(`${wallTime}Z`);
  if (Number.isNaN(asUtc.getTime())) {
    throw new Error(`invalid wall time: ${wallTime}`);
  }
  const cacheKey = `${wallTime}|${timeZone}`;
  let offset = OFFSET_CACHE.get(cacheKey);
  if (offset === undefined) {
    offset = timezoneOffsetMs(asUtc, timeZone);
    OFFSET_CACHE.set(cacheKey, offset);
  }
  return new Date(asUtc.getTime() - offset);
}

/** 形如 +08:00 的偏移字符串 → 分钟数；非法返回 null */
export function parseOffsetMinutes(offset: string): number | null {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  if (Number(m[2]) > 14 || Number(m[3]) > 59) return null;
  return m[1] === "-" ? -minutes : minutes;
}

/** UTC 时刻 → 指定时区的 datetime-local 值（YYYY-MM-DDTHH:mm，供输入框默认值） */
export function utcToZonedWallTimeInput(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
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
