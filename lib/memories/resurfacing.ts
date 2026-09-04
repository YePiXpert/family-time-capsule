import "server-only";

import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { memoryEvent } from "@/db/schema/memory";
import { zonedWallTimeToUtc } from "@/lib/metadata/time";
import {
  hydrateTimelineEntries,
  type MemoryEventRow,
  type TimelineEntry,
} from "@/lib/memories/service";

export type ResurfacingKind =
  | "on_this_day"
  | "month_ago"
  | "hundred_days"
  | "year_ago";

export type ResurfacingGroup = {
  kind: ResurfacingKind;
  label: string;
  description: string;
  targetDate: string;
  entries: TimelineEntry[];
};

export type ResurfacingResult = {
  today: string;
  groups: ResurfacingGroup[];
  hasHistory: boolean;
};

type DateParts = { year: number; month: number; day: number };

function localDateParts(value: Date, timezone: string): DateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day") };
}

function formatDateOnly(parts: DateParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function fromUtcDate(date: Date): DateParts {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function shiftDays(parts: DateParts, days: number): DateParts {
  return fromUtcDate(
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days)),
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftMonths(parts: DateParts, months: number): DateParts {
  const monthIndex = parts.year * 12 + (parts.month - 1) + months;
  const year = Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12 + 1;
  return {
    year,
    month,
    day: Math.min(parts.day, daysInMonth(year, month)),
  };
}

function utcRangeForLocalDate(date: string, timezone: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const next = new Date(parsed.getTime() + 86_400_000).toISOString().slice(0, 10);
  return {
    from: zonedWallTimeToUtc(`${date}T00:00:00`, timezone),
    before: zonedWallTimeToUtc(`${next}T00:00:00`, timezone),
  };
}

function eventLocalDate(event: MemoryEventRow, timezone: string): string {
  return formatDateOnly(localDateParts(event.occurredAt, timezone));
}

/**
 * Family-timezone-aware resurfacing. The database query is one bounded
 * candidate read; card media, people and tags are then hydrated in batches.
 */
export async function getResurfacing(
  familyId: string,
  timezone: string,
  now = new Date(),
  perGroup = 4,
): Promise<ResurfacingResult> {
  const todayParts = localDateParts(now, timezone);
  const today = formatDateOnly(todayParts);
  const monthAgo = formatDateOnly(shiftMonths(todayParts, -1));
  const hundredDaysAgo = formatDateOnly(shiftDays(todayParts, -100));
  const yearAgo = formatDateOnly(shiftMonths(todayParts, -12));
  const exactTargets = [monthAgo, hundredDaysAgo, yearAgo];
  const exactRanges = exactTargets.map((date) => utcRangeForLocalDate(date, timezone));

  // UTC month/day can differ from the family-local date by one day. Query the
  // three neighboring UTC dates, then make the exact IANA-timezone decision in JS.
  const monthDayCandidates = [-1, 0, 1].map((offset) => {
    const date = shiftDays(todayParts, offset);
    return `${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
  });
  const candidates = await getDb()
    .select()
    .from(memoryEvent)
    .where(
      and(
        eq(memoryEvent.familyId, familyId),
        eq(memoryEvent.status, "confirmed"),
        isNull(memoryEvent.deletedAt),
        lt(memoryEvent.occurredAt, now),
        or(
          ...exactRanges.map((range) =>
            and(
              gte(memoryEvent.occurredAt, range.from),
              lt(memoryEvent.occurredAt, range.before),
            ),
          ),
          sql`strftime('%m-%d', ${memoryEvent.occurredAt}, 'unixepoch') in (${sql.join(
            monthDayCandidates.map((value) => sql`${value}`),
            sql`, `,
          )})`,
        ),
      ),
    )
    .orderBy(desc(memoryEvent.occurredAt), desc(memoryEvent.id))
    .limit(160);

  const safeLimit = Math.min(Math.max(Math.floor(perGroup), 1), 12);
  const byDate = new Map<string, MemoryEventRow[]>();
  for (const event of candidates) {
    const date = eventLocalDate(event, timezone);
    const rows = byDate.get(date) ?? [];
    rows.push(event);
    byDate.set(date, rows);
  }
  const take = (events: MemoryEventRow[]) => events.slice(0, safeLimit);

  const groupRows: Array<Omit<ResurfacingGroup, "entries"> & { rows: MemoryEventRow[] }> = [
    {
      kind: "year_ago",
      label: "一年前",
      description: "去年的今天，家里正在发生这些事",
      targetDate: yearAgo,
      rows: take(byDate.get(yearAgo) ?? []),
    },
    {
      kind: "month_ago",
      label: "一个月前",
      description: "看看这一个月里悄悄发生的变化",
      targetDate: monthAgo,
      rows: take(byDate.get(monthAgo) ?? []),
    },
    {
      kind: "hundred_days",
      label: "百天前",
      description: "一百天足以让很多小事变得珍贵",
      targetDate: hundredDaysAgo,
      rows: take(byDate.get(hundredDaysAgo) ?? []),
    },
  ];
  const todayMonthDay = today.slice(5);
  const onThisDayRows = candidates.filter((event) => {
    const local = eventLocalDate(event, timezone);
    return local.slice(5) === todayMonthDay && local.slice(0, 4) !== today.slice(0, 4);
  });
  groupRows.unshift({
    kind: "on_this_day",
    label: "这一天",
    description: "往年的同月同日，家庭留下了这些片段",
    targetDate: today,
    rows: take(onThisDayRows),
  });

  const uniqueEvents = [
    ...new Map(
      groupRows
        .flatMap((group) => group.rows)
        .map((event) => [event.id, event] as const),
    ).values(),
  ];
  const hydrated = await hydrateTimelineEntries(familyId, uniqueEvents);
  const hydratedById = new Map(hydrated.map((entry) => [entry.event.id, entry]));
  const groups = groupRows.map(({ rows, ...group }) => ({
    ...group,
    entries: rows.flatMap((row) => {
      const entry = hydratedById.get(row.id);
      return entry ? [entry] : [];
    }),
  }));
  return {
    today,
    groups,
    hasHistory: groups.some((group) => group.entries.length > 0),
  };
}
