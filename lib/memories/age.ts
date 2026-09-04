/**
 * 孩子年龄展示（#008/#009）。
 * 展示永远从 child.birthDate + event.occurredAt 现算，不依赖持久化字符串；
 * DB 里的 ageDays 只是导出/核对用快照。
 */

import { computeAgeDays } from "./service";

function localDate(at: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
}

/** 日历精确的年/月/日差（家庭时区日界，与 computeAgeDays 的口径一致） */
export function calendarDiff(
  birthDate: string,
  at: Date,
  timeZone: string,
): { years: number; months: number; days: number } {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  const localAt = localDate(at, timeZone);
  let years = localAt.getUTCFullYear() - birth.getUTCFullYear();
  let months = localAt.getUTCMonth() - birth.getUTCMonth();
  let days = localAt.getUTCDate() - birth.getUTCDate();
  if (days < 0) {
    months -= 1;
    // 借上一个月的真实天数
    const prevMonthLast = new Date(
      Date.UTC(localAt.getUTCFullYear(), localAt.getUTCMonth(), 0),
    );
    days += prevMonthLast.getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
}

/**
 * 人类可读年龄：
 * 出生前 N 天 / 出生当天 / 第 N 天（<100 天）/ N 岁M 个月 / N 岁
 */
export function formatAgeLabel(
  birthDate: string | null | undefined,
  at: Date,
  timeZone: string,
): string {
  if (!birthDate) return "";
  const totalDays = computeAgeDays(birthDate, at, timeZone);
  if (totalDays === null) return "";
  if (totalDays < 0) return `出生前 ${-totalDays} 天`;
  if (totalDays === 0) return "出生当天";
  if (totalDays === 30) return "满月";
  if (totalDays === 100) return "百天";
  if (totalDays < 100) return `第 ${totalDays} 天`;
  const { years, months } = calendarDiff(birthDate, at, timeZone);
  if (years === 0) return `${months} 个月`;
  if (months === 0) return `${years} 岁`;
  return `${years} 岁 ${months} 个月`;
}
