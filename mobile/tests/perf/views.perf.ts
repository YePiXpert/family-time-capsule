/**
 * 页面派生数据（书架 / 月册 / 年册 / 搜索 / 选材 / 人物 / 回顾 / 设置）、纸书排版与 AI 上下文。
 */
import { describe, it } from "vitest";
import { editorContext, recapContext, applyYearPicks } from "../../src/ai/state";
import { layoutBook, type BookPhoto } from "../../src/local/book";
import { dateLabel } from "../../src/local/dates";
import {
  compareDates,
  freezeLibrary,
  monthKey,
  recordTitle,
  sortedRecords,
  yearKey,
  type Library,
  type LocalRecord,
  type Stored,
} from "../../src/local/model";
import { searchRecords } from "../../src/local/search";
import { yearBookInput, yearBookMonth } from "../../src/local/yearbook";
import { bench, reportTo } from "./harness";
import { busiestYear, makeLibrary, sizes } from "./fixtures";
import {
  firstsRender,
  monthScreen,
  peopleRender,
  pickerRender,
  quotesRender,
  recapScreen,
  searchScreen,
  settingsRender,
  shelfMemoOthers,
  shelfMemoRecords,
  shelfRender,
  storageRender,
  todayKey,
  yearMemoRecords,
  yearMonths,
  yearRender,
} from "./screens";

reportTo(__filename);
const G = "views";

/** Year.tsx:296-340 makeBook：12 个月分组 + yearBookInput + layoutBook。 */
function makeBook(state: Library, year: string, records: Stored<LocalRecord>[]) {
  const applied = applyYearPicks(state.yearPicks?.[year], records);
  const bookPhoto = (id: string): BookPhoto | undefined => {
    const m = state.media[id];
    if (m?.kind !== "image") return undefined;
    return { key: id, aspect: m.width && m.height ? m.width / m.height : 4 / 3 };
  };
  const bookRecord = (r: Stored<LocalRecord>) => ({
    title: recordTitle(r),
    date: dateLabel(r.date),
    text: r.text,
    ...(r.by ? { by: r.by } : {}),
    photos: r.mediaIds.map(bookPhoto).filter((p): p is BookPhoto => !!p),
  });
  const yearFirsts = records.filter((r) => r.first).sort((a, b) => compareDates(a.date, b.date));
  const months = yearMonths(records, year);
  return layoutBook(
    yearBookInput({
      year,
      title: state.yearPicks?.[year]?.title,
      profileName: state.profile.name,
      birthday: state.profile.birthday,
      fullName: state.profile.fullName,
      motto: state.profile.motto,
      stats: `${records.length} 段时光`,
      note: state.yearNotes[year] ?? "",
      months: months.map((monthRecords, i) => ({
        label: `${i + 1} 月`,
        ...yearBookMonth(monthRecords, applied?.months[`${year}-${String(i + 1).padStart(2, "0")}`], bookRecord),
      })),
      firsts: yearFirsts.map((r) => ({ title: recordTitle(r), date: dateLabel(r.date) })),
      colophon: `${year} 年`,
    }),
  );
}

describe("views", () => {
  for (const n of sizes()) {
    it(`derived views @ ${n}`, async () => {
      const state = makeLibrary(n);
      freezeLibrary(state);
      const year = busiestYear(state);
      const day = todayKey();
      const sorted = shelfMemoRecords(state);
      const month = monthKey(sorted[0]!.date);
      const yearRecords = yearMemoRecords(state, year);
      const note = `year ${year}: ${yearRecords.length} records`;

      await bench(G, "sortedRecords (full library sort, Date.parse in comparator)", n, () => sortedRecords(state));
      await bench(G, "reference: sort with precomputed timestamps", n, () => {
        const keyed = Object.values(state.records).map((r) => [Date.parse(r.date), r] as const);
        keyed.sort((a, b) => b[0] - a[0] || compareDates(b[1].date, a[1].date) || a[1].id.localeCompare(b[1].id));
      });
      await bench(G, "monthKey x all records (new Date per record)", n, () => { for (const r of sorted) monthKey(r.date); });

      // 书架（首页）
      const memo = shelfMemoOthers(state, day);
      await bench(G, "Shelf cold render (all memos miss: sort + others + per-render)", n, () =>
        shelfRender(state, shelfMemoRecords(state), shelfMemoOthers(state, day)));
      await bench(G, "Shelf warm re-render (memo hit; every draft save / sync status / layout)", n, () =>
        shelfRender(state, sorted, memo), { runs: 15 });

      // 月册
      await bench(G, "Month screen (filter month + sort + group), per query change", n, () => monthScreen(state, month, ""));
      await bench(G, "Month screen with in-month search 「她」", n, () => monthScreen(state, month, "她"));

      // 年册
      await bench(G, "Year memo (sort whole library, then filter year)", n, () => yearMemoRecords(state, year), { note });
      await bench(G, "Year warm re-render (per-render stats + 12 month tiles)", n, () => yearRender(state, year, yearRecords), { note });
      await bench(G, "Year book: makeBook (group + yearBookInput + layoutBook)", n, () => makeBook(state, year, yearRecords), { note });

      // 搜索：每敲一个字整段 useMemo 重算。
      await bench(G, "Search screen per keystroke, empty query", n, () => searchScreen(state, ""));
      await bench(G, "Search screen per keystroke, common 「她」", n, () => searchScreen(state, "她"));
      await bench(G, "Search screen per keystroke, rare 「pigeon」", n, () => searchScreen(state, "pigeon"));
      await bench(G, "searchRecords only (pre-sorted), rare 「pigeon」", n, () => searchRecords(sorted, "pigeon"));
      await bench(G, "Search screen per keystroke, year filter", n, () => searchScreen(state, "", { year }));

      // 其它页
      await bench(G, "Picker (album material) per tap: sort + months + filter", n, () => pickerRender(state, ""));
      await bench(G, "People screen render (6 persons x all records)", n, () => peopleRender(state));
      await bench(G, "Quotes screen render (full sort, no memo)", n, () => quotesRender(state));
      await bench(G, "Firsts screen render (full sort, no memo)", n, () => firstsRender(state));
      await bench(G, "Recap screen (memo on whole state: sort + filter + recapOf)", n, () => recapScreen(state, year), { note });
      await bench(G, "Settings home render (bytes, unsigned, by counts)", n, () => settingsRender(state));
      await bench(G, "Storage page render (referencedMedia + unused)", n, () => storageRender(state));

      // AI 上下文
      const y400 = [...yearRecords];
      // editorContext 逐档收紧正文与标题，最后一档一年 400 条也放得下；抛错只剩人为的极端转义。
      const tryContext = (records: typeof y400) => {
        try {
          return editorContext(year, records, state.media).context.length;
        } catch {
          return -1;
        }
      };
      const full = tryContext(y400);
      await bench("ai", "editorContext (busiest year, <=400 records)", n, () => tryContext(y400), {
        note: `${Math.min(400, y400.length)} records sent -> ${full < 0 ? "THROWS 这一年的记录太多" : `${full} chars`}`,
      });
      const small = y400.slice(-150);
      const ok = tryContext(small);
      await bench("ai", "editorContext (150 records of that year)", n, () => tryContext(small), { note: ok < 0 ? "THROWS" : `${ok} chars` });
      await bench("ai", "recapContext", n, () => recapContext(yearRecords, state.yearNotes[year] ?? "", yearRecords.filter((r) => r.quote).map((r) => r.text)), { note });
      await bench("ai", "Year recap assist: sortedRecords+filter (Year.tsx:74)", n, () => sortedRecords(state).filter((r) => yearKey(r.date) === year));
    });
  }
});
