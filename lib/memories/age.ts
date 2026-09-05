/**
 * 孩子年龄展示（#008/#009）。
 * 展示永远从 child.birthDate + event.occurredAt 现算，不依赖持久化字符串；
 * DB 里的 ageDays 只是导出/核对用快照。
 */

import { computeAgeDays } from "./service";

import { calendarAge, calendarDate, addCalendarMonths } from "@/mobile/src/utils/calendar";

export function calendarDiff(birthDate: string, at: Date, timeZone: string) {
  return calendarAge(birthDate, calendarDate(at, timeZone));
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
  if (calendarDate(at, timeZone) === addCalendarMonths(birthDate, 1)) return "满月";
  if (totalDays === 100) return "百天";
  if (totalDays < 100) return `第 ${totalDays} 天`;
  const { years, months } = calendarDiff(birthDate, at, timeZone);
  if (years === 0) return `${months} 个月`;
  if (months === 0) return `${years} 岁`;
  return `${years} 岁 ${months} 个月`;
}
