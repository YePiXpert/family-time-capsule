type DatedRecord = { id: string; occurredAt: string; occurredAtPrecision: string };

/** A sorting anchor for an unknown date or year is not evidence of its month. */
function recordCalendarMonth(record: DatedRecord, formatter: Intl.DateTimeFormat): string | null {
  if (!["exact", "approximate", "date_only", "month"].includes(record.occurredAtPrecision)) return null;
  try {
    const parts = formatter.formatToParts(new Date(record.occurredAt));
    const month = `${parts.find(part => part.type === "year")?.value.padStart(4, "0")}-${parts.find(part => part.type === "month")?.value}`;
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null;
  } catch {
    return null;
  }
}

export function indexCalendarMonths(records: readonly DatedRecord[], timezone: string): {
  counts: ReadonlyMap<string, number>;
  byId: ReadonlyMap<string, string>;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" });
  const counts = new Map<string, number>();
  const byId = new Map<string, string>();
  for (const record of records) {
    const month = recordCalendarMonth(record, formatter);
    if (month) {
      counts.set(month, (counts.get(month) ?? 0) + 1);
      byId.set(record.id, month);
    }
  }
  return { counts, byId };
}

export function calendarMonthLabel(month: string): string {
  return `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5, 7))} 月`;
}
