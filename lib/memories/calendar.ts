import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { isLiveFamilyPrincipal } from "@/lib/authz/principal";
import type { FamilyContext } from "@/lib/family/context";
import {
  createContributionAccessSnapshot,
  readableAssetPredicate,
} from "@/lib/authz/contribution-access";
import { addCalendarDays, calendarDate } from "@/mobile/src/utils/calendar";
import { calendarRange } from "./calendar-range";

export type BrowseFilters = { person?: string; media?: string; tag?: string };
export function browsePredicate(
  context: FamilyContext,
  filters: BrowseFilters,
): SQL {
  const media = filters.media;
  if (media && !["image", "audio", "video", "document"].includes(media))
    throw new Error("invalid_media");
  const readable = readableAssetPredicate(
    createContributionAccessSnapshot(context),
    sql`ba.id`,
  );
  return sql`e.family_id = ${context.familyId} and e.status = 'confirmed' and e.deleted_at is null
    ${filters.person ? sql`and exists (select 1 from memory_event_participant p where p.memory_event_id = e.id and p.family_id = ${context.familyId} and p.person_id = ${filters.person})` : sql``}
    ${filters.tag ? sql`and exists (select 1 from memory_event_tag t where t.memory_event_id = e.id and t.family_id = ${context.familyId} and t.tag = ${filters.tag})` : sql``}
    ${media ? sql`and exists (select 1 from memory_event_asset ma join asset ba on ba.id = ma.asset_id where ma.memory_event_id = e.id and ma.family_id = ${context.familyId} and ba.family_id = ${context.familyId} and ba.type = ${media} and ${readable})` : sql``}`;
}

export async function getCalendarMonth(
  context: FamilyContext,
  month: string,
  filters: BrowseFilters = {},
) {
  if (!(await isLiveFamilyPrincipal(context))) throw new Error("forbidden");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("invalid_month");
  const dates: string[] = [];
  for (
    let date = `${month}-01`;
    date.startsWith(month);
    date = addCalendarDays(date, 1)
  )
    dates.push(date);
  const intervals = sql.join(
    dates.map((date) => {
      const range = calendarRange(date, context.familyTimezone);
      return sql`(${date}, ${range.from.getTime() / 1000}, ${range.before.getTime() / 1000})`;
    }),
    sql`, `,
  );
  const predicate = browsePredicate(context, filters);
  const counts = getDb().all<{ date: string; count: number }>(sql`
    with days(day, lo, hi) as (values ${intervals})
    select days.day as date, count(e.id) as count from days left join memory_event e
      on e.occurred_at >= days.lo and e.occurred_at < days.hi and ${predicate}
    group by days.day order by days.day`);
  const readable = readableAssetPredicate(
    createContributionAccessSnapshot(context),
    sql`ba.id`,
  );
  const covers = getDb().all<{
    date: string;
    eventId: string;
    assetId: string;
  }>(sql`
    with days(day, lo, hi) as (values ${intervals}), candidates as (
      select days.day as date, e.id as eventId,
        coalesce((select id from asset thumb where thumb.original_asset_id = ba.id and thumb.family_id = ${context.familyId} and thumb.derivative_type = 'thumbnail' order by thumb.created_at desc, thumb.id desc limit 1), ba.id) as assetId,
        row_number() over (partition by days.day order by e.occurred_at desc, e.id desc) as position
      from days join memory_event e on e.occurred_at >= days.lo and e.occurred_at < days.hi
      join asset ba on ba.id = e.cover_asset_id
      where ${predicate} and ba.type = 'image' and ${readable}
    ) select date, eventId, assetId from candidates where position <= 3 order by date, position`);
  return {
    month,
    timezone: context.familyTimezone,
    days: counts.map((day) => ({
      ...day,
      covers: covers.filter((cover) => cover.date === day.date),
    })),
  };
}

export async function getBrowsePage(
  context: FamilyContext,
  key: string,
  filters: BrowseFilters = {},
  cursor?: string | null,
) {
  if (!(await isLiveFamilyPrincipal(context))) throw new Error("forbidden");
  const range = calendarRange(key, context.familyTimezone);
  let after: { at: number; id: string } | undefined;
  if (cursor) {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString()) as {
      at: number;
      id: string;
    };
    if (
      !Number.isSafeInteger(parsed.at) ||
      typeof parsed.id !== "string" ||
      parsed.id.length > 128
    )
      throw new Error("invalid_cursor");
    after = parsed;
  }
  const rows = getDb().all<{
    id: string;
    title: string;
    occurredAt: number;
  }>(sql`
    select e.id, e.title, e.occurred_at as occurredAt from memory_event e
    where ${browsePredicate(context, filters)} and e.occurred_at >= ${range.from.getTime() / 1000} and e.occurred_at < ${range.before.getTime() / 1000}
      ${after ? sql`and (e.occurred_at, e.id) < (${after.at}, ${after.id})` : sql``}
    order by e.occurred_at desc, e.id desc limit 31`);
  const entries = rows
    .slice(0, 30)
    .map((row) => ({
      ...row,
      occurredAt: new Date(row.occurredAt * 1000).toISOString(),
      date: calendarDate(
        new Date(row.occurredAt * 1000),
        context.familyTimezone,
      ),
    }));
  const last = rows[29];
  return {
    entries,
    nextCursor:
      rows.length > 30
        ? Buffer.from(
            JSON.stringify({ at: last.occurredAt, id: last.id }),
          ).toString("base64url")
        : null,
  };
}
