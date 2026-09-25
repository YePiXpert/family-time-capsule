/**
 * 页面渲染时在 JS 线程上做的派生计算，按原文件逐行照抄（.tsx 牵涉 react-native，没法在 node 里直接引入）。
 * 每个函数注明出处行号；源文件改了，这里要跟着改，否则基准量的就不是真代码。
 * cold = 库一变、useMemo 全部失效的那次渲染；warm = 记忆命中后的每一次重渲染（打字防抖落盘、
 * 同步状态变化、onLayout、换日）。
 */
import { isEmptyDraft } from "../../src/local/empties";
import { sortLetters } from "../../src/local/letters";
import {
  compareDates,
  monthKey,
  recordsOfPerson,
  referencedMedia,
  sortedRecords,
  unsignedRecords,
  yearKey,
  type Library,
  type LocalMedia,
  type LocalRecord,
  type Stored,
} from "../../src/local/model";
import { backupDueOf, bookNudgeOf, nudgeOf, pickNudge, type NudgeKind } from "../../src/local/nudge";
import { heroItems, shelfTiles } from "../../src/local/shelf-plan";
import { recordMatches, searchRecords, SEARCH_LIMIT } from "../../src/local/search";
import { byCountsOf, byLine, recapOf } from "../../src/local/recap";
import { dateLabel, toDayKey } from "../../src/local/dates";

/** Shelf.tsx:1501 */
export function coverForRecords(
  monthRecords: { mediaIds: readonly string[]; coverId: string | null }[],
  media: Record<string, Stored<LocalMedia>>,
): Stored<LocalMedia> | undefined {
  for (const r of monthRecords) {
    const candidate = r.coverId ? media[r.coverId] : undefined;
    if (candidate?.kind === "image") return candidate;
    for (const id of r.mediaIds) {
      const m = media[id];
      if (m?.kind === "image") return m;
    }
  }
  return undefined;
}

/** Shelf.tsx:937-940 —— useMemo([recordMap])。 */
export const shelfMemoRecords = (state: Library) => sortedRecords({ records: state.records });
/** Shelf.tsx:949-968 —— albums / drafts / letters 三个 useMemo。 */
export function shelfMemoOthers(state: Library, day: string) {
  const albums = Object.values(state.albums).sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );
  const drafts = Object.values(state.drafts)
    .filter((d) => d.recordId || !isEmptyDraft(d))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const letters = sortLetters(Object.values(state.letters), new Date(`${day}T00:00:00`));
  const unsigned = unsignedRecords({ records: state.records }); // Shelf.tsx:1002
  return { albums, drafts, letters, unsigned };
}
/**
 * Shelf.tsx:941-1011 与 1053-1066（每张月册）、1140-1148（每张翻页卡的封面）——每次渲染都重算，没有记忆。
 */
export function shelfRender(state: Library, records: readonly Stored<LocalRecord>[], memo: ReturnType<typeof shelfMemoOthers>) {
  const months = [...new Set(records.map((r) => monthKey(r.date)))];
  const years = [...new Set(records.map((r) => yearKey(r.date)))];
  const firsts = records.filter((r) => r.first).length;
  const quotes = records.filter((r) => r.quote).length;
  const today = new Date();
  const hero = heroItems(records, today);
  const tiles = shelfTiles({
    months,
    years,
    firsts,
    quotes,
    albumIds: memo.albums.map((a) => a.id),
    letterIds: memo.letters.map((l) => l.id),
  });
  const latestDraft = memo.drafts[0];
  const nudge = nudgeOf(records[0]?.date ?? null, latestDraft?.updatedAt ?? null, memo.drafts.length);
  const bookNudge = bookNudgeOf(today, years, Object.keys(state.yearBooksBoundAt ?? {}));
  const backupDue = backupDueOf(records[records.length - 1]?.date ?? null, null, today);
  const candidates: NudgeKind[] = [];
  if (memo.unsigned.length) candidates.push("by");
  if (bookNudge) candidates.push("book");
  if (backupDue) candidates.push("backup");
  if (nudge) candidates.push("rhythm");
  pickNudge(candidates, state.nudgeClosedAt, today);
  let covers = 0;
  for (const tile of tiles.time)
    if (tile.kind === "month") {
      const monthRecords = records.filter((r) => monthKey(r.date) === tile.month);
      if (coverForRecords(monthRecords, state.media)) covers++;
    }
  for (const item of hero) if (coverForRecords([item.record], state.media)) covers++;
  return { tiles, hero, covers };
}

/** Home.tsx:188-205 —— 月册页（Month）：useMemo([recordMap, query, month]) + 每次渲染按天分组。 */
export function monthScreen(state: Library, month: string, query: string, columns = 2) {
  const records = Object.values(state.records)
    .filter((r) => monthKey(r.date) === month)
    .filter((r) => recordMatches(r, query))
    .sort((a, b) => compareDates(b.date, a.date) || a.id.localeCompare(b.id));
  return monthGroups(records, columns);
}
export function monthGroups(records: Stored<LocalRecord>[], columns = 2) {
  const byDay = new Map<string, Stored<LocalRecord>[]>();
  for (const record of records) {
    const day = dateLabel(record.date);
    const group = byDay.get(day) ?? [];
    group.push(record);
    byDay.set(day, group);
  }
  return [...byDay].map(([title, dayRecords]) => {
    const data: Stored<LocalRecord>[][] = [];
    for (let i = 0; i < dayRecords.length; i += columns) data.push(dayRecords.slice(i, i + columns));
    return { title, count: dayRecords.length, data };
  });
}

/** Year.tsx:238-244 —— useMemo([recordMap, year])：先排全库再按年筛。 */
export const yearMemoRecords = (state: Library, year: string) =>
  sortedRecords({ records: state.records }).filter((r) => yearKey(r.date) === year);
/** Year.tsx:245-296 与 452-470（每个月册）——每次渲染重算。 */
export function yearRender(state: Library, year: string, records: Stored<LocalRecord>[], person = "") {
  const visibleRecords = person ? recordsOfPerson(records, person) : records;
  const firsts = visibleRecords.filter((r) => r.first).sort((a, b) => compareDates(a.date, b.date));
  const months = [...new Set(visibleRecords.map((r) => monthKey(r.date)))];
  const photos = records.reduce((n, r) => n + r.mediaIds.filter((id) => state.media[id]?.kind === "image").length, 0);
  const av = records.reduce(
    (n, r) =>
      n +
      r.mediaIds.filter((id) => {
        const kind = state.media[id]?.kind;
        return kind === "video" || kind === "audio";
      }).length,
    0,
  );
  const yearFirsts = records.filter((r) => r.first).sort((a, b) => compareDates(a.date, b.date));
  const writers = byLine(byCountsOf(records));
  const yearPhotoIds = [...new Set(records.flatMap((r) => r.mediaIds).filter((id) => state.media[id]?.kind === "image"))]; // useMemo 284
  const cover = coverForRecords(records, state.media);
  let covers = 0;
  for (const m of months) {
    const monthRecords = visibleRecords.filter((r) => monthKey(r.date) === m);
    if (coverForRecords(monthRecords, state.media)) covers++;
  }
  return { firsts, photos, av, yearFirsts, writers, yearPhotoIds, cover, covers };
}

/** SearchScreen.tsx:29-66 —— 一个 useMemo，依赖里有 query：每敲一个字整段重算。 */
export function searchScreen(state: Library, query: string, filters: { first?: boolean; year?: string; person?: string; by?: string } = {}) {
  const all = sortedRecords({ records: state.records });
  const byCount = new Map<string, number>();
  for (const r of all) if (r.by) byCount.set(r.by, (byCount.get(r.by) ?? 0) + 1);
  const kinds = Object.fromEntries(Object.values(state.media).map((m) => [m.id, m.kind] as const));
  return {
    found: searchRecords(all, query, { ...filters, media: "any" }, kinds, SEARCH_LIMIT + 1),
    years: [...new Set(all.map((r) => yearKey(r.date)))].sort((a, b) => b.localeCompare(a)),
    persons: Object.values(state.persons).sort((a, b) => a.name.localeCompare(b.name, "zh")),
    writers: [...byCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh")).map(([name]) => name),
  };
}

/** Albums.tsx:277-279 与 364-372 —— 选材页：每点一条记录（改 selection → 库变）整段重算，没有记忆。 */
export function pickerRender(state: Library, month: string, person = "") {
  const records = sortedRecords(state),
    months = [...new Set(records.map((r) => monthKey(r.date)))];
  const data = records.filter(
    (r) => (!month || monthKey(r.date) === month) && (!person || r.personIds?.includes(person)),
  );
  return { months, data };
}

/** People.tsx:30-37 —— 每位家人一行，usageOf 每行扫全部记录与草稿。 */
export function peopleRender(state: Library) {
  const people = Object.values(state.persons).sort((a, b) => a.name.localeCompare(b.name, "zh"));
  const usageOf = (id: string) =>
    Object.values(state.records).filter((r) => r.personIds?.includes(id)).length +
    Object.values(state.drafts).filter((d) => d.content.personIds?.includes(id)).length;
  return people.map((p) => usageOf(p.id));
}

/** Quotes.tsx:27-29 与 Shelf.tsx:1537-1539（第一次合集）——每次渲染整库排序，没有记忆。 */
export const quotesRender = (state: Library) =>
  sortedRecords(state).filter((r) => r.quote).sort((a, b) => compareDates(a.date, b.date));
export const firstsRender = (state: Library) =>
  sortedRecords(state).filter((r) => r.first).sort((a, b) => compareDates(a.date, b.date));

/** RecapScreen.tsx:27-33 —— 两个 useMemo，依赖 state（整库对象）：任何改动都失效。 */
export function recapScreen(state: Library, year: string) {
  const records = sortedRecords(state).filter((r) => yearKey(r.date) === year);
  return recapOf(records, state.media as Record<string, LocalMedia>);
}

/** Settings.tsx:103-123（设置首页）与 520-524（本机存储页）——每次渲染重算。 */
export function settingsRender(state: Library) {
  const bytes = Object.values(state.media).reduce((n, m) => n + m.bytes, 0);
  const unsigned = unsignedRecords(state).length;
  const used = new Map<string, number>();
  for (const r of Object.values(state.records)) if (r.by) used.set(r.by, (used.get(r.by) ?? 0) + 1);
  return { bytes, unsigned, used };
}
export function storageRender(state: Library) {
  const refs = referencedMedia(state);
  const bytes = Object.values(state.media).reduce((n, m) => n + m.bytes, 0);
  const unused = Object.values(state.media).filter((m) => !refs.has(m.id));
  return { bytes, unused: unused.length };
}

/** 年册 / 纸书的 12 个月分组：Year.tsx:324-331。 */
export function yearMonths(records: Stored<LocalRecord>[], year: string) {
  const monthKeys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  return monthKeys.map((key) => records.filter((r) => monthKey(r.date) === key));
}

export const todayKey = () => toDayKey(new Date());
