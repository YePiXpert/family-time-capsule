import { addCalendarDays, addCalendarMonths, calendarAge, calendarDate, parseCalendarDate } from "../utils/calendar";

export type GrowthChild = { id: string; displayName: string; isChild: boolean; birthDate: string | null };
export function selectGrowthChild<T extends Pick<GrowthChild, "id" | "displayName" | "isChild">>(people: readonly T[]): T | null {
  const children = people.filter(p => p.isChild);
  const named = children.filter(p => p.displayName.trim() === "小美");
  return named.length === 1 ? named[0]! : children.length === 1 ? children[0]! : null;
}
export type GrowthStage = { key: string; label: string; from: string; before: string };
export function growthMonthLabel(month: number) {
  return month === 1 ? "第一个月" : month === 2 ? "第二个月" : `第 ${month} 个月`;
}
export function growthStage(birthDate: string, key: string): GrowthStage | null {
  try {
    parseCalendarDate(birthDate);
    if (key === "birth") return { key, label: "出生", from: birthDate, before: addCalendarDays(birthDate, 1) };
    if (!/^[1-9]\d{0,2}$/.test(key)) return null;
    const month = Number(key);
    return { key, label: growthMonthLabel(month), from: addCalendarMonths(birthDate, month - 1), before: addCalendarMonths(birthDate, month) };
  } catch { return null; }
}
export function growthStages(birthDate: string | null, at: Date, timezone: string): GrowthStage[] {
  if (!birthDate) return [];
  try {
    const today = calendarDate(at, timezone);
    if (today < birthDate) return [];
    const age = calendarAge(birthDate, today);
    const months = Math.min(999, age.years * 12 + age.months + 1);
    return [growthStage(birthDate, "birth")!, ...Array.from({ length: months }, (_, i) => growthStage(birthDate, String(i + 1))!)];
  } catch { return []; }
}
export function eventGrowthStage(birthDate: string, occurredAt: string, precision: string, timezone: string): GrowthStage | null {
  if (!["exact", "date_only", "approximate"].includes(precision)) return null;
  try {
    const day = calendarDate(new Date(occurredAt), timezone);
    if (day < birthDate) return null;
    const age = calendarAge(birthDate, day);
    return growthStage(birthDate, String(age.years * 12 + age.months + 1));
  } catch { return null; }
}
