/**
 * 孩子年龄展示（#008/#009）。
 * 展示永远从 child.birthDate + event.occurredAt 现算，不依赖持久化字符串；
 * DB 里的 ageDays 只是导出/核对用快照。
 */

import { computeAgeDays } from "./service";

/** 日历精确的年/月/日差（UTC 日界，与 computeAgeDays 的口径一致） */
export function calendarDiff(
  birthDate: string,
  at: Date,
): { years: number; months: number; days: number } {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  let years = at.getUTCFullYear() - birth.getUTCFullYear();
  let months = at.getUTCMonth() - birth.getUTCMonth();
  let days = at.getUTCDate() - birth.getUTCDate();
  if (days < 0) {
    months -= 1;
    // 借上一个月的真实天数
    const prevMonthLast = new Date(
      Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 0),
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
export function formatAgeLabel(birthDate: string | null | undefined, at: Date): string {
  if (!birthDate) return "";
  const totalDays = computeAgeDays(birthDate, at);
  if (totalDays === null) return "";
  if (totalDays < 0) return `出生前 ${-totalDays} 天`;
  if (totalDays === 0) return "出生当天";
  if (totalDays === 30) return "满月";
  if (totalDays === 100) return "百天";
  if (totalDays < 100) return `第 ${totalDays} 天`;
  const { years, months } = calendarDiff(birthDate, at);
  if (years === 0) return `${months} 个月`;
  if (months === 0) return `${years} 岁`;
  return `${years} 岁 ${months} 个月`;
}
