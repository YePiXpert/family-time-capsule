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
  context?: import("@/lib/family/context").FamilyContext,
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
  // §5：自动回顾同样按对象级读者裁决，不把私密事件推给无权读者。
  const visibleEvent = context
    ? (await import("@/lib/authz/event-access")).eventVisibilityCondition(
        (await import("@/lib/authz/event-access")).createEventAccessSnapshot(context),
        sql`memory_event`,
      )
    : undefined;
  const candidates = await getDb()
    .select()
    .from(memoryEvent)
    .where(
      and(
        eq(memoryEvent.familyId, familyId),
        eq(memoryEvent.status, "confirmed"),
        isNull(memoryEvent.deletedAt),
        lt(memoryEvent.occurredAt, now),
        visibleEvent,
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
  // §8 FIND-9：当前用户的屏蔽偏好只作用于自动回顾——事件、人物、日期
  // 范围与全局暂停；不影响 hasHistory 与主动浏览/搜索。
  const blockedEvents = new Set<string>();
  const blockedPeople = new Set<string>();
  const blockedRanges: Array<{ from: string; to: string }> = [];
  let paused = false;
  if (context) {
    const { resurfacingPreference } = await import("@/db/schema/resurfacing");
    const { eq, and: andEq } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const preferences = getDb()
      .select()
      .from(resurfacingPreference)
      .where(
        andEq(
          eq(resurfacingPreference.familyId, familyId),
          eq(resurfacingPreference.userId, context.userId),
        ),
      )
      .all();
    for (const preference of preferences) {
      if (preference.kind === "pause") paused = true;
      else if (preference.kind === "event") blockedEvents.add(preference.targetKey);
      else if (preference.kind === "person") blockedPeople.add(preference.targetKey);
      else if (preference.kind === "date_range" && preference.dateFrom && preference.dateTo) {
        blockedRanges.push({ from: preference.dateFrom, to: preference.dateTo });
      }
    }
  }
  const participantByEvent = new Map<string, Set<string>>();
  if (blockedPeople.size > 0 && candidates.length > 0) {
    const rows = getDb()
      .select({ memoryEventId: sql<string>`memory_event_id`, personId: sql<string>`person_id` })
      .from(sql`memory_event_participant`)
      .where(sql`memory_event_id in (${sql.join(candidates.map((event) => sql`${event.id}`), sql`, `)})`)
      .all();
    for (const row of rows) {
      const set = participantByEvent.get(row.memoryEventId) ?? new Set<string>();
      set.add(row.personId);
      participantByEvent.set(row.memoryEventId, set);
    }
  }
  const visibleCandidates = candidates.filter((event) => {
    if (blockedEvents.has(event.id)) return false;
    const people = participantByEvent.get(event.id);
    if (people && [...blockedPeople].some((personId) => people.has(personId))) return false;
    if (blockedRanges.length > 0) {
      const localDate = eventLocalDate(event, timezone);
      if (blockedRanges.some((range) => localDate >= range.from && localDate <= range.to)) return false;
    }
    return true;
  });
  const effectiveCandidates = paused ? [] : visibleCandidates;
  const byDate = new Map<string, MemoryEventRow[]>();
  for (const event of effectiveCandidates) {
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
  const onThisDayRows = effectiveCandidates.filter((event) => {
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
  const hydrated = await hydrateTimelineEntries(familyId, uniqueEvents, context);
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
    // hasHistory 表示家庭是否有可回顾的内容，与当前用户的屏蔽/暂停无关
    //（暂停回顾不等于家庭没有历史，首页空状态引导不因此误触发）。
    hasHistory: candidates.length > 0,
  };
}
