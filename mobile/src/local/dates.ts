/** Keepsake date derivations: the age line on the shelf and milestone days. */

export function parseBirthday(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.getFullYear() > 0 ? date : null;
}

/** 「2024年6月15日」；未填或无效生日返回 null。 */
export function birthdayLabel(birthday: string): string | null {
  const born = parseBirthday(birthday);
  return born
    ? `${born.getFullYear()}年${born.getMonth() + 1}月${born.getDate()}日`
    : null;
}

const dayStart = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

const DAYS = 86400000;

function calendarDays(from: Date, to: Date): number {
  return Math.round((dayStart(to) - dayStart(from)) / DAYS);
}

/** 「2 岁 3 个月 · 来到世界第 487 天」；未填或无效生日返回 null。 */
export function ageLine(birthday: string, today = new Date()): string | null {
  const born = parseBirthday(birthday);
  if (!born || dayStart(today) < dayStart(born)) return null;
  let years = today.getFullYear() - born.getFullYear();
  let months = today.getMonth() - born.getMonth();
  if (today.getDate() < born.getDate()) months--;
  if (months < 0) {
    years--;
    months += 12;
  }
  const days = calendarDays(born, today) + 1;
  const dayText = `来到世界第 ${days} 天`;
  const age = [
    years ? `${years} 岁` : "",
    years || months ? `${months} 个月` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return age ? `${age} · ${dayText}` : dayText;
}

/** 第 n 个生日的本地日历日 "YYYY-MM-DD"；2 月 29 日出生的退到 2 月 28。无效生日返回 null。 */
export function nthBirthday(birthday: string, n: number): string | null {
  const born = parseBirthday(birthday);
  if (!born || !Number.isInteger(n) || n < 0) return null;
  const year = born.getFullYear() + n;
  const candidate = new Date(year, born.getMonth(), born.getDate());
  if (candidate.getMonth() !== born.getMonth())
    candidate.setDate(candidate.getDate() - 1);
  return toDayKey(candidate);
}

/** 本地日历日 "YYYY-MM-DD"。 */
export function toDayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type Milestone = {
  kind: "birthday" | "hundred" | "anniversary";
  years?: number;
};

/** 当天命中的纪念时刻：每年生日（含周岁）、出生后第 100 天。 */
export function milestoneOf(
  birthday: string,
  today = new Date(),
): Milestone | null {
  const born = parseBirthday(birthday);
  if (!born || dayStart(today) < dayStart(born)) return null;
  const days = calendarDays(born, today);
  // 出生当天算第 1 天，第 100 天即出生后 99 个整日。
  if (days === 99) return { kind: "hundred" };
  const sameDay =
    today.getMonth() === born.getMonth() && today.getDate() === born.getDate();
  if (!sameDay) return null;
  const years = today.getFullYear() - born.getFullYear();
  if (years === 0) return { kind: "birthday" };
  return { kind: "anniversary", years };
}

export function milestoneLabel(m: Milestone): string {
  switch (m.kind) {
    case "hundred":
      return "来到世界第 100 天";
    case "birthday":
      return "来到世界的第 1 天";
    case "anniversary":
      return `${m.years} 周岁生日`;
  }
}

/** 印章圆环里的数字：百天 100、出生 1、周岁 N。 */
export function milestoneNumeral(m: Milestone): string {
  return m.kind === "hundred"
    ? "100"
    : m.kind === "birthday"
      ? "1"
      : String(m.years);
}
