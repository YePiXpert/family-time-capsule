/** Pure family-calendar arithmetic. Never uses the device's local timezone. */
export function calendarDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function parseCalendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("invalid_date");
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error("invalid_date");
  return date;
}

export function addCalendarDays(value: string, days: number): string {
  const date = parseCalendarDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Anniversaries clamp Jan 31 → Feb 28/29 and Feb 29 → Feb 28. */
export function addCalendarMonths(value: string, months: number): string {
  const date = parseCalendarDate(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(date.getTime());
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  date.setUTCDate(Math.min(day, last.getUTCDate()));
  return date.toISOString().slice(0, 10);
}

export function calendarAge(birthDate: string, date: string) {
  const birth = parseCalendarDate(birthDate),
    at = parseCalendarDate(date);
  let months =
    (at.getUTCFullYear() - birth.getUTCFullYear()) * 12 +
    at.getUTCMonth() -
    birth.getUTCMonth();
  if (addCalendarMonths(birthDate, months) > date) months--;
  const anchor = parseCalendarDate(addCalendarMonths(birthDate, months));
  return {
    years: Math.floor(months / 12),
    months: ((months % 12) + 12) % 12,
    days: Math.round((at.getTime() - anchor.getTime()) / 86_400_000),
  };
}

export function ageLocations(birthDate: string) {
  parseCalendarDate(birthDate);
  return [
    { label: "出生前", date: addCalendarDays(birthDate, -1) },
    { label: "出生当天", date: birthDate },
    { label: "满月", date: addCalendarMonths(birthDate, 1) },
    { label: "百天", date: addCalendarDays(birthDate, 100) },
    { label: "周岁", date: addCalendarMonths(birthDate, 12) },
  ];
}
