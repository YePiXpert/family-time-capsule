import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { bookProject } from "@/db/schema/book";
import { capsule } from "@/db/schema/capsule";
import { person } from "@/db/schema/family";
import { reviewPeriodEvent } from "@/db/schema/review";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { isCapsuleUnlocked } from "@/lib/capsules/service";
import {
  createCollection,
  getCollection,
  saveCollection,
} from "@/lib/collections/service";
import type { FamilyContext } from "@/lib/family/context";
import { browsePredicate } from "@/lib/memories/calendar";
import { getOrCreateRangeReviewPeriod } from "@/lib/review/service";
import {
  addCalendarDays,
  addCalendarMonths,
  calendarDate,
  parseCalendarDate,
} from "@/mobile/src/utils/calendar";
import type { BookAudience, BookTemplate } from "@/mobile/src/books/types";
import type {
  BookReview,
  BookReviewKind,
  BookReviewMaterial,
  BookReviewRange,
} from "@/mobile/src/books/review-types";
import {
  assertBookContext,
  BookError,
  createBookProject,
  getBookProject,
  saveBookProject,
  saveBookVersion,
} from "./service";
import { addBookSelections } from "./select";
import { createBookSourceResolver, sourceFingerprint } from "./sources";
export type ReviewOptions = BookReviewRange & {
  audience?: BookAudience;
  template?: BookTemplate;
};
function prepare(
  context: FamilyContext,
  options: ReviewOptions,
  write = false,
) {
  assertBookContext(context, write);
  let days: number;
  try {
    days =
      (parseCalendarDate(options.endDate).getTime() -
        parseCalendarDate(options.startDate).getTime()) /
        86400000 +
      1;
  } catch {
    throw new BookError("invalid_date_range");
  }
  if (days < 1 || days > 366) throw new BookError("review_range_limit");
  const audience = options.audience ?? "family",
    template = options.template ?? "growth";
  if (
    !["family", "personal"].includes(audience) ||
    !["photos", "growth", "letters"].includes(template)
  )
    throw new BookError("invalid_book");
  if (audience === "personal" && !context.personId)
    throw new BookError("person_required");
  const { period, window } = getOrCreateRangeReviewPeriod(
    context,
    options.startDate,
    options.endDate,
  );
  const child = getDb()
    .select()
    .from(person)
    .where(and(eq(person.familyId, context.familyId), eq(person.isChild, true)))
    .get();
  const closed = getDb()
    .select()
    .from(capsule)
    .where(eq(capsule.familyId, context.familyId))
    .all()
    .filter(
      (c) =>
        !isCapsuleUnlocked(c, child?.birthDate ?? null, context.familyTimezone),
    )
    .map((c) => c.id);
  const predicate = sql`${browsePredicate(context, {})} and e.occurred_at >= ${window.start.getTime() / 1000} and e.occurred_at < ${window.end.getTime() / 1000}
    ${
      closed.length
        ? sql`and not exists(select 1 from capsule_event ce where ce.family_id=${context.familyId} and ce.memory_event_id=e.id and ce.capsule_id in (${sql.join(
            closed.map((id) => sql`${id}`),
            sql`, `,
          )}))`
        : sql``
    }`;
  const key = `review:${sourceFingerprint([options.startDate, options.endDate, audience, template, audience === "personal" ? context.personId : null])}`;
  const draft = getDb()
    .select()
    .from(bookProject)
    .where(
      and(
        eq(bookProject.familyId, context.familyId),
        eq(bookProject.draftKey, key),
        eq(bookProject.status, "active"),
        isNull(bookProject.deletedAt),
      ),
    )
    .get();
  return {
    period,
    window,
    predicate,
    child,
    audience,
    template,
    key,
    draft,
    resolve: createBookSourceResolver(context, audience),
  };
}
function includedSql(
  projectId: string | null,
  kind: BookReviewKind,
  target: SQL,
) {
  if (!projectId) return sql`0`;
  const column = {
    memory: "memory_event_id",
    contribution: "contribution_id",
    story: "story_id",
  }[kind];
  return sql`exists(select 1 from book_source_ref sr join book_block_source bs on bs.source_ref_id=sr.id where sr.project_id=${projectId} and sr.kind=${kind} and sr.${sql.identifier(column)}=${target})`;
}
export function getBookReview(
  context: FamilyContext,
  options: ReviewOptions & { kind?: BookReviewKind; cursor?: string | null },
): BookReview {
  return getDb().transaction(() => {
    const p = prepare(context, options),
      kind = options.kind ?? "memory";
    if (!["memory", "story", "contribution"].includes(kind))
      throw new BookError("invalid_source");
    const scope = sourceFingerprint([p.key, kind]),
      counts = getDb().all<{ month: string; count: number }>(
        sql`select substr(family_date(e.occurred_at,${context.familyTimezone}),1,7) month,count(*) count from memory_event e where ${p.predicate} group by month order by month`,
      );
    const months: BookReview["months"] = [];
    for (
      let month = options.startDate.slice(0, 7);
      month <= options.endDate.slice(0, 7);
      month = addCalendarMonths(`${month}-01`, 1).slice(0, 7)
    )
      months.push({
        month,
        count: counts.find((c) => c.month === month)?.count ?? 0,
      });
    const selectedCount = getDb().get<{ n: number }>(
      sql`select count(*) n from memory_event e join review_period_event r on r.memory_event_id=e.id and r.review_period_id=${p.period.id} where ${p.predicate}`,
    )!.n;
    let after: { at: number; id: string } | null = null;
    if (options.cursor)
      try {
        const v = JSON.parse(
          Buffer.from(options.cursor, "base64url").toString(),
        );
        if (
          v.scope !== scope ||
          !Number.isSafeInteger(v.at) ||
          typeof v.id !== "string" ||
          v.id.length > 128
        )
          throw Error();
        after = v;
      } catch {
        throw new BookError("invalid_cursor");
      }
    const table =
      kind === "memory"
        ? sql`memory_event e`
        : kind === "contribution"
          ? sql`contribution c join memory_event e on e.id=c.memory_event_id`
          : sql`story s`;
    const id =
        kind === "memory"
          ? sql`e.id`
          : kind === "contribution"
            ? sql`c.id`
            : sql`s.id`,
      at = kind === "story" ? sql`s.period_start` : sql`e.occurred_at`;
    const conditions =
      kind === "story"
        ? sql`s.family_id=${context.familyId} and s.deleted_at is null and s.status='published' and s.period_start < ${p.window.end.getTime() / 1000} and s.period_end > ${p.window.start.getTime() / 1000}`
        : sql`${p.predicate} ${kind === "contribution" ? sql`and c.deleted_at is null` : sql``}`;
    const rows = getDb().all<{
      id: string;
      at: number;
      milestone: string | null;
      selected: number;
      included: number;
    }>(sql`select ${id} id,${at} at,${kind === "memory" ? sql`e.milestone_type` : sql`null`} milestone,
      ${kind === "memory" ? sql`exists(select 1 from review_period_event r where r.review_period_id=${p.period.id} and r.memory_event_id=e.id)` : sql`0`} selected,
      ${includedSql(p.draft?.id ?? null, kind, id)} included from ${table} where ${conditions} ${after ? sql`and (${at},${id}) < (${after.at},${after.id})` : sql``} order by ${at} desc,${id} desc limit 121`);
    const materials: BookReviewMaterial[] = [];
    let last: (typeof rows)[number] | undefined,
      scanned = 0;
    for (const row of rows.slice(0, 120)) {
      last = row;
      scanned++;
      const source = p.resolve(kind, row.id);
      if (!source.state.available) continue;
      materials.push({
        id: row.id,
        kind,
        title: source.state.label,
        date: calendarDate(new Date(row.at * 1000), context.familyTimezone),
        selected: Boolean(row.selected),
        included: Boolean(row.included),
        milestone: row.milestone,
        author: source.state.author,
      });
      if (materials.length === 30) break;
    }
    const newMemoryCount = p.draft
      ? getDb().get<{ n: number }>(
          sql`select count(*) n from memory_event e where ${p.predicate} and not ${includedSql(p.draft.id, "memory", sql`e.id`)}`,
        )!.n
      : 0;
    return {
      startDate: options.startDate,
      endDate: options.endDate,
      periodId: p.period.id,
      timezone: context.familyTimezone,
      birthDate: p.child?.birthDate ?? null,
      total: counts.reduce((n, c) => n + c.count, 0),
      selectedCount,
      months,
      materials,
      nextCursor:
        rows.length > scanned && last
          ? Buffer.from(
              JSON.stringify({ scope, at: last.at, id: last.id }),
            ).toString("base64url")
          : null,
      draft: p.draft
        ? {
            id: p.draft.id,
            title: p.draft.title,
            revision: p.draft.revision,
            newMemoryCount,
          }
        : null,
      audience: p.audience,
      template: p.template,
      canWrite: hasFamilyCapability(context.role, "event:write"),
    };
  });
}
export function setBookReviewHighlight(
  context: FamilyContext,
  options: ReviewOptions,
  id: string,
  selected: boolean,
) {
  return getDb().transaction(() => {
    const p = prepare(context, options, true);
    if (
      typeof selected !== "boolean" ||
      !getDb().get(
        sql`select e.id from memory_event e where ${p.predicate} and e.id=${id}`,
      ) ||
      !p.resolve("memory", id).state.available
    )
      throw new BookError("source_unavailable", 403);
    if (selected)
      getDb()
        .insert(reviewPeriodEvent)
        .values({
          id: randomUUID(),
          familyId: context.familyId,
          reviewPeriodId: p.period.id,
          memoryEventId: id,
          selectedByUserId: context.userId,
        })
        .onConflictDoNothing()
        .run();
    else
      getDb()
        .delete(reviewPeriodEvent)
        .where(
          and(
            eq(reviewPeriodEvent.reviewPeriodId, p.period.id),
            eq(reviewPeriodEvent.memoryEventId, id),
          ),
        )
        .run();
  });
}
type Selection = { kind: BookReviewKind; id: string };
function chosen(
  context: FamilyContext,
  p: ReturnType<typeof prepare>,
  selection: unknown,
): Selection[] {
  if (selection === undefined) {
    const highlighted = getDb().get<{ n: number }>(
      sql`select count(*) n from memory_event e join review_period_event r on r.memory_event_id=e.id and r.review_period_id=${p.period.id} where ${p.predicate}`,
    )!.n;
    selection = getDb()
      .all<{ id: string }>(
        sql`select e.id from memory_event e where ${p.predicate} ${highlighted ? sql`and exists(select 1 from review_period_event r where r.review_period_id=${p.period.id} and r.memory_event_id=e.id)` : sql``} order by e.occurred_at,e.id limit 101`,
      )
      .map((r) => ({ kind: "memory", id: r.id }));
  }
  if (
    !Array.isArray(selection) ||
    selection.length > 100 ||
    selection.some(
      (s) =>
        !s ||
        !["memory", "contribution", "story"].includes(s.kind) ||
        typeof s.id !== "string" ||
        s.id.length > 128,
    )
  )
    throw new BookError("review_selection_limit");
  const unique = new Set<string>();
  for (const s of selection as Selection[]) {
    if (unique.has(`${s.kind}:${s.id}`))
      throw new BookError("duplicate_source");
    unique.add(`${s.kind}:${s.id}`);
    const source = p.resolve(s.kind, s.id);
    if (!source.state.available) throw new BookError("source_unavailable", 403);
    const inRange =
      s.kind === "story"
        ? getDb().get(
            sql`select id from story where id=${s.id} and family_id=${context.familyId} and period_start < ${p.window.end.getTime() / 1000} and period_end > ${p.window.start.getTime() / 1000}`,
          )
        : getDb().get(
            sql`select e.id from memory_event e where ${p.predicate} and e.id=${source.eventId}`,
          );
    if (!inRange) throw new BookError("source_outside_period", 409);
  }
  return selection as Selection[];
}
export function createBookFromReview(
  context: FamilyContext,
  options: ReviewOptions,
  selection?: unknown,
) {
  return getDb().transaction(() => {
    const p = prepare(context, options, true);
    if (p.draft) return { id: p.draft.id, existing: true };
    const selected = chosen(context, p, selection),
      id = createBookProject(
        context,
        `${options.startDate} 至 ${options.endDate} 的家庭回顾`,
        p.template,
        p.audience,
        p.key,
      );
    let book = getBookProject(context, id);
    const chapters = [];
    for (
      let month = options.startDate.slice(0, 7);
      month <= options.endDate.slice(0, 7);
      month = addCalendarMonths(`${month}-01`, 1).slice(0, 7)
    )
      chapters.push({ id: randomUUID(), title: `${month} 的记忆` });
    book = saveBookProject(context, id, book.revision, {
      ...book,
      startDate: options.startDate,
      endDate: options.endDate,
      chapters,
    });
    const groups = new Map<string, Selection[]>();
    for (const s of selected) {
      const source = p.resolve(s.kind, s.id);
      const row =
        s.kind === "story"
          ? getDb().get<{ at: number }>(
              sql`select period_start at from story where id=${s.id} and family_id=${context.familyId}`,
            )
          : getDb().get<{ at: number }>(
              sql`select occurred_at at from memory_event where id=${source.eventId} and family_id=${context.familyId}`,
            );
      const month = row
        ? calendarDate(new Date(row.at * 1000), context.familyTimezone).slice(
            0,
            7,
          )
        : options.startDate.slice(0, 7);
      const chapter =
        chapters.find((c) => c.title.startsWith(month)) ?? chapters[0]!;
      groups.set(chapter.id, [...(groups.get(chapter.id) ?? []), s]);
    }
    for (const [chapterId, selection] of groups)
      book = addBookSelections(
        context,
        id,
        book.revision,
        selection,
        chapterId,
      );
    saveBookVersion(context, id, book.revision);
    return { id, existing: false };
  });
}
export function createAlbumFromReview(
  context: FamilyContext,
  options: ReviewOptions,
  selection?: unknown,
) {
  return getDb().transaction(() => {
    const p = prepare(context, options, true),
      selected = chosen(context, p, selection);
    if (selected.some((s) => s.kind !== "memory"))
      throw new BookError("album_requires_memories");
    const id = createCollection(
        context,
        `${options.startDate} 至 ${options.endDate} · 相册草稿`,
      ),
      album = getCollection(context, id);
    saveCollection(context, id, album.revision, {
      ...album,
      startDate: options.startDate,
      endDate: options.endDate,
      description: "从已有记忆建立的整理草稿，请自行检查选材与说明。",
      items: selected.map((s) => ({
        id: randomUUID(),
        sectionId: null,
        memoryEventId: s.id,
        caption: "",
      })),
    });
    return { id };
  });
}

/** Home reads one month count and a bounded active shelf, without selecting material bodies. */
export function getBookHome(context: FamilyContext, now = new Date()) {
  const month = calendarDate(now, context.familyTimezone).slice(0, 7),
    startDate = `${month}-01`,
    endDate = addCalendarDays(addCalendarMonths(startDate, 1), -1);
  const p = prepare(context, { startDate, endDate });
  const count = getDb().get<{ n: number }>(
    sql`select count(*) n from memory_event e where ${p.predicate}`,
  )!.n;
  const activeBooks = getDb()
    .select({
      id: bookProject.id,
      title: bookProject.title,
      subtitle: bookProject.subtitle,
    })
    .from(bookProject)
    .where(
      and(
        eq(bookProject.familyId, context.familyId),
        eq(bookProject.status, "active"),
        isNull(bookProject.deletedAt),
        sql`(${bookProject.audience}='family' or (${bookProject.audience}='personal' and ${bookProject.ownerPersonId}=${context.personId}))`,
      ),
    )
    .orderBy(sql`${bookProject.updatedAt} desc`, sql`${bookProject.id} desc`)
    .limit(3)
    .all();
  return { monthlyReview: { month, startDate, endDate, count }, activeBooks };
}
