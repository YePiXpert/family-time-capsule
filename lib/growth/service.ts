import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { person } from "@/db/schema/family";
import { memoryEvent } from "@/db/schema/memory";
import { bookProject } from "@/db/schema/book";
import { contribution } from "@/db/schema/contribution";
import type { FamilyContext } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { eventVisibilityCondition, createEventAccessSnapshot } from "@/lib/authz/event-access";
import { zonedWallTimeToUtc } from "@/lib/metadata/time";
import { selectGrowthChild, growthStage, growthStages, growthMonthLabel } from "@/mobile/src/design/growth-stages";
import { addCalendarDays, calendarDate } from "@/mobile/src/utils/calendar";
import { assertBookContext, BookError, createBookProject, getBookProject, saveBookProject, saveBookVersion } from "@/lib/books/projects/service";
import { addBookSelections } from "@/lib/books/projects/select";
import { createBookSourceResolver } from "@/lib/books/projects/sources";

function materials(context: FamilyContext, month: number) {
  assertBookContext(context);
  if (!Number.isSafeInteger(month) || month < 1 || month > 999) throw new BookError("invalid_month");
  const db = getDb();
  const children = db.select().from(person).where(and(eq(person.familyId, context.familyId), eq(person.isChild, true))).all();
  const child = selectGrowthChild(children);
  const stage = child?.birthDate ? growthStage(child.birthDate, String(month)) : null;
  if (!child || !stage || stage.from > calendarDate(new Date(), context.familyTimezone)) return { child, stage: null, entries: [], draftKey: null };
  const from = zonedWallTimeToUtc(`${stage.from}T00:00:00`, context.familyTimezone);
  const before = zonedWallTimeToUtc(`${stage.before}T00:00:00`, context.familyTimezone);
  const entries = db.select().from(memoryEvent).where(and(
    eq(memoryEvent.familyId, context.familyId), eq(memoryEvent.status, "confirmed"), isNull(memoryEvent.deletedAt),
    eq(memoryEvent.visibility, "family"), eventVisibilityCondition(createEventAccessSnapshot(context)),
    sql`${memoryEvent.occurredAt} >= ${Math.floor(from.getTime()/1000)} and ${memoryEvent.occurredAt} < ${Math.floor(before.getTime()/1000)}`,
    sql`${memoryEvent.occurredAtPrecision} in ('exact','approximate','date_only')`,
    sql`(${memoryEvent.childPersonId}=${child.id} or (${memoryEvent.childPersonId} is null and ((${children.length}=1 and not exists(select 1 from memory_event_participant anyp where anyp.memory_event_id=${memoryEvent.id} and anyp.family_id=${context.familyId})) or exists(select 1 from memory_event_participant gp where gp.family_id=${context.familyId} and gp.memory_event_id=${memoryEvent.id} and gp.person_id=${child.id}))))`,
  )).orderBy(asc(memoryEvent.occurredAt), asc(memoryEvent.id)).all();
  return { child, stage, entries, draftKey: `growth:${child.id}:${child.birthDate}:${month}:family` };
}
export function getGrowthOverview(context: FamilyContext, month = 1) {
  const { child, stage, entries, draftKey } = materials(context, month);
  const book = draftKey ? getDb().select().from(bookProject).where(and(eq(bookProject.familyId, context.familyId), eq(bookProject.draftKey, draftKey), isNull(bookProject.deletedAt))).orderBy(asc(bookProject.createdAt)).get() : null;
  return {
    child: child ? { id: child.id, name: child.displayName, birthDate: child.birthDate } : null,
    stages: growthStages(child?.birthDate ?? null, new Date(), context.familyTimezone),
    month, title: `${child?.displayName ?? "小美"}的${stage?.label ?? growthMonthLabel(month)}`,
    stage, memoryCount: entries.length, bookId: book?.id ?? null,
    canCreate: hasFamilyCapability(context.role, "event:write"),
    pendingBirthday: !child?.birthDate, audience: "family" as const,
  };
}
/** Opening a growing book adds newly eligible sources once, without rewriting edits.
 * Source tombstones already retained by book saves keep deliberately removed pages out. */
export function openGrowthBook(context: FamilyContext, month = 1) {
  return getDb().transaction(() => {
    assertBookContext(context, true);
    const { child, stage, entries, draftKey } = materials(context, month);
    if (!child || !stage || !draftKey) throw new BookError("child_birthday_required");
    if (!entries.length) throw new BookError("no_growth_memories");
    const db = getDb();
    const prior = db.select().from(bookProject).where(and(eq(bookProject.familyId, context.familyId), eq(bookProject.draftKey, draftKey), isNull(bookProject.deletedAt))).orderBy(asc(bookProject.createdAt)).get();
    if (prior?.status === "finished") return getBookProject(context, prior.id);
    const id = prior?.id ?? createBookProject(context, `${child.displayName}的${stage.label}`, "growth", "family", draftKey);
    let book = getBookProject(context, id);
    const oldBlockIds = new Set(book.blocks.map(b => b.id));
    const known = new Set(book.sources.filter(s => s.kind === "memory").map(s => s.memoryEventId));
    const resolve = createBookSourceResolver(context, "family");
    const selection = entries.filter(e => !known.has(e.id) && resolve("memory", e.id).state.available).map(e => ({ kind: "memory" as const, id: e.id }));
    // This is the existing publication size limit, surfaced instead of silently truncating a month.
    if (book.blocks.length + selection.length * 3 > 480) throw new BookError("growth_book_too_large");
    for (let i = 0; i < selection.length; i += 100) book = addBookSelections(context, id, book.revision, selection.slice(i, i + 100));
    // A family member may add words after the original memory was included.
    const used = new Set(book.blocks.flatMap(b => b.sourceIds));
    const knownVoices = new Set(book.sources.filter(s => s.kind === "contribution").map(s => s.contributionId));
    for (const source of book.sources.filter(s => s.kind === "memory" && s.memoryEventId && used.has(s.id))) {
      const voices = db.select({ id: contribution.id }).from(contribution).where(and(eq(contribution.memoryEventId, source.memoryEventId!), isNull(contribution.deletedAt))).orderBy(asc(contribution.createdAt)).all();
      for (const voice of voices) if (!knownVoices.has(voice.id) && resolve("contribution", voice.id).state.available) {
        book = addBookSelections(context, id, book.revision, [{ kind: "contribution", id: voice.id }], book.blocks.find(b => b.sourceIds.includes(source.id))?.chapterId);
        knownVoices.add(voice.id);
      }
    }
    if (!prior) {
      const date = (block: typeof book.blocks[number]) => block.sourceIds.map(id => book.sourceStates[id]?.occurredAt).find(Boolean) ?? "";
      book.blocks.sort((a, b) => date(a).localeCompare(date(b)));
      book = saveBookProject(context, id, book.revision, {
        ...book, startDate: stage.from, endDate: addCalendarDays(stage.before, -1),
        chapters: book.chapters.map((c, i) => i === 0 ? { ...c, title: stage.label } : c),
        coverAssetId: Object.values(book.sourceStates).find(s => s.available && s.asset?.type === "image")?.asset?.id ?? null,
      });
    } else if (book.blocks.some(b => !oldBlockIds.has(b.id))) {
      // Insert new date groups near their date. Keep the relative order of all edited pages.
      const previous = book.blocks.filter(b => oldBlockIds.has(b.id));
      const added = book.blocks.filter(b => !oldBlockIds.has(b.id));
      const date = (block: typeof book.blocks[number]) => block.sourceIds.map(id => book.sourceStates[id]?.occurredAt).find(Boolean) ?? "";
      for (const block of added) {
        const target = previous.findIndex(b => b.kind === "date" && b.chapterId === block.chapterId && date(b) > date(block));
        previous.splice(target < 0 ? previous.length : target, 0, block);
      }
      book = saveBookProject(context, id, book.revision, { ...book, blocks: previous });
    }
    if (!prior || book.blocks.some(b => !oldBlockIds.has(b.id))) saveBookVersion(context, id, book.revision);
    return book;
  }, { behavior: "immediate" });
}
