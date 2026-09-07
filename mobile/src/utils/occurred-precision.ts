/**
 * 事件发生时间精度（正式 1.0 §6）。
 *
 * occurredAt 始终保存一个可用于排序/分组的 UTC 锚点，但锚点从不冒充
 * 精度：显示、日历、年龄与日期筛选都按精度裁决——
 * - exact/approximate/date_only 携带真实时刻/日期；
 * - month/year 的锚点取该月/该年首日（家庭时区），仅用于排序与月度分组；
 * - unknown 的锚点取记录创建时刻，只用于稳定排序，永不显示为发生时间，
 *   也不参与日期范围筛选与年龄计算。
 */

export const OCCURRED_AT_PRECISIONS = [
  "exact",
  "approximate",
  "date_only",
  "month",
  "year",
  "unknown",
] as const;

export type OccurredAtPrecision = (typeof OCCURRED_AT_PRECISIONS)[number];

export function isOccurredAtPrecision(value: unknown): value is OccurredAtPrecision {
  return typeof value === "string" && (OCCURRED_AT_PRECISIONS as readonly string[]).includes(value);
}

/** 历史值只可能是这三种；其余精度为新值。 */
export const LEGACY_PRECISIONS: readonly OccurredAtPrecision[] = ["exact", "approximate", "date_only"];

/** 需要用户给出日期（天级或更精确）的精度。 */
export function precisionRequiresDate(precision: OccurredAtPrecision): boolean {
  return precision === "exact" || precision === "approximate" || precision === "date_only";
}

/** 参与日历「某一天」列表与年龄计算的精度（天级信息真实存在）。 */
export function precisionHasDay(precision: OccurredAtPrecision): boolean {
  return precision !== "month" && precision !== "year" && precision !== "unknown";
}

/** 参与日期范围筛选的精度（unknown 的锚点是创建时刻，不能当发生时间筛）。 */
export function precisionSupportsDateFilter(precision: OccurredAtPrecision): boolean {
  return precision !== "unknown";
}

function partsInZone(utc: Date, timezone: string): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(utc);
}

function readPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

/** 面向用户的日期文案：按精度输出，绝不泄露虚假精度。 */
export function formatOccurredLabel(
  precision: OccurredAtPrecision,
  occurredAt: string | Date,
  timezone: string,
): string {
  return formatOccurredImpl(precision, occurredAt, timezone, false);
}

/**
 * 卡片等紧凑场景：只到「日」，不带时分——exact/approximate 也不显示
 * 时间（列表卡片保持原有日级设计；完整时刻在详情页展示）。
 */
export function formatOccurredDateLabel(
  precision: OccurredAtPrecision,
  occurredAt: string | Date,
  timezone: string,
): string {
  return formatOccurredImpl(precision, occurredAt, timezone, true);
}

function formatOccurredImpl(
  precision: OccurredAtPrecision,
  occurredAt: string | Date,
  timezone: string,
  dayOnly: boolean,
): string {
  if (precision === "unknown") return "时间不确定";
  const utc = typeof occurredAt === "string" ? new Date(occurredAt) : occurredAt;
  if (Number.isNaN(utc.getTime())) return "时间不确定";
  const parts = partsInZone(utc, timezone);
  const year = readPart(parts, "year");
  const month = readPart(parts, "month");
  const day = readPart(parts, "day");
  switch (precision) {
    case "year":
      return `${year}年`;
    case "month":
      return `${year}年${Number(month)}月`;
    case "date_only":
      return `${year}年${Number(month)}月${Number(day)}日`;
    case "approximate":
      return `大约 ${year}年${Number(month)}月${Number(day)}日`;
    case "exact": {
      if (dayOnly) return `${year}年${Number(month)}月${Number(day)}日`;
      const hour = readPart(parts, "hour").padStart(2, "0");
      const minute = readPart(parts, "minute").padStart(2, "0");
      return `${year}年${Number(month)}月${Number(day)}日 ${hour}:${minute}`;
    }
  }
}

/**
 * 从用户输入推导 UTC 锚点。month 期望 "YYYY-MM"，year 期望 "YYYY"，
 * 其余期望完整时刻或日期；unknown 返回 null（调用方用创建时刻做锚点）。
 */
export function anchorFromPrecisionInput(input: {
  precision: OccurredAtPrecision;
  /** exact/approximate: "YYYY-MM-DDTHH:mm"（家庭时区墙钟）；date_only: "YYYY-MM-DD"；month: "YYYY-MM"；year: "YYYY" */
  wall: string;
  timezone: string;
  toUtc: (wallTime: string, timezone: string) => Date;
}): Date | null {
  const { precision, wall, timezone, toUtc } = input;
  const trimmed = wall.trim();
  try {
    switch (precision) {
      case "exact":
      case "approximate":
        return toUtc(`${trimmed.length === 16 ? trimmed : `${trimmed}:00`}`, timezone);
      case "date_only":
        return toUtc(`${trimmed.slice(0, 10)}T00:00:00`, timezone);
      case "month":
        return /^\d{4}-\d{2}$/u.test(trimmed) ? toUtc(`${trimmed}-01T00:00:00`, timezone) : null;
      case "year":
        return /^\d{4}$/u.test(trimmed) ? toUtc(`${trimmed}-01-01T00:00:00`, timezone) : null;
      case "unknown":
        return null;
    }
  } catch {
    return null;
  }
}
