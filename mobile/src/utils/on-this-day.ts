import type { LocalTimelineEvent } from "../types";
import { calendarDate } from "./calendar";

/** Choose only an already-visible record with an explicitly known calendar day. */
export function onThisDay(events: readonly LocalTimelineEvent[], today: string, timezone: string): { event: LocalTimelineEvent; yearsAgo: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  let picked: { event: LocalTimelineEvent; yearsAgo: number } | null = null;
  for (const event of events) {
    if (!["exact", "date_only"].includes(event.occurredAtPrecision)) continue;
    try {
      const date = calendarDate(new Date(event.occurredAt), timezone);
      if (date.slice(5) !== today.slice(5)) continue;
      const yearsAgo = Number(today.slice(0, 4)) - Number(date.slice(0, 4));
      if (yearsAgo <= 0) continue;
      if (!picked || yearsAgo < picked.yearsAgo || (yearsAgo === picked.yearsAgo && event.id.localeCompare(picked.event.id) < 0)) picked = { event, yearsAgo };
    } catch { /* Invalid dates never turn an ordering anchor into a memory. */ }
  }
  return picked;
}
