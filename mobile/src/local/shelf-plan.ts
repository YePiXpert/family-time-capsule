/**
 * 首页首屏的排法，纯函数、不碰界面：「最近」翻页卡里摆哪几段时光，「书架」横条上摆哪几本书。
 * 首页一屏放下：年份、月册、专题与信都收进一条横着翻的书架，不再一段段往下排。
 */

/** 书架横条上的一本书：只描述种类与顺序，长相交给 Shelf.tsx。 */
export type ShelfTile =
  | { kind: "year"; year: string }
  | { kind: "month"; month: string }
  | { kind: "firsts" }
  | { kind: "quotes" }
  | { kind: "album"; id: string }
  | { kind: "letter"; id: string };

/** 书架上最近几个有记录的月份摆成月册；更早的只剩年度册。 */
export const SHELF_MONTHS = 6;

/**
 * 书架横条分两组，中间一道细线：
 * - 时间：最近 6 个有记录的月份按年归组，每年一本年度册打头、名下月册新到旧；
 *   不在这 6 个月里的更早年份只摆一本年度册（新到旧）。
 * - 专题与信：第一次合集、她说的话（有才摆）、相册、信，顺序由调用方排好。
 * `months`（YYYY-MM）与 `years`（YYYY）都是有记录的、新到旧。
 */
export function shelfTiles(input: {
  months: readonly string[];
  years: readonly string[];
  firsts: number;
  quotes: number;
  albumIds: readonly string[];
  letterIds: readonly string[];
}): { time: ShelfTile[]; topics: ShelfTile[] } {
  const recent = input.months.slice(0, SHELF_MONTHS);
  const recentYears = [...new Set(recent.map((m) => m.slice(0, 4)))];
  const time: ShelfTile[] = [];
  for (const year of recentYears) {
    time.push({ kind: "year", year });
    for (const month of recent)
      if (month.startsWith(year)) time.push({ kind: "month", month });
  }
  for (const year of input.years)
    if (!recentYears.includes(year)) time.push({ kind: "year", year });
  const topics: ShelfTile[] = [];
  if (input.firsts > 0) topics.push({ kind: "firsts" });
  if (input.quotes > 0) topics.push({ kind: "quotes" });
  for (const id of input.albumIds) topics.push({ kind: "album", id });
  for (const id of input.letterIds) topics.push({ kind: "letter", id });
  return { time, topics };
}

/** 「最近」翻页卡上的一张：那年今日的卡带着「N 年前的今天」。 */
export type HeroItem<T> = { record: T; yearsAgo?: number };

/** 「最近」翻页卡最多几段（那年今日另算）。 */
export const RECENT_LIMIT = 10;

/**
 * 「最近」翻页卡：往年同月同日的时光（那年今日）排在最前、全部可翻，然后是最近 10 段；
 * 同一段不出现两次。`records` 新到旧；月日按本机时区比较，与阅读页的日期一致。
 */
export function heroItems<T extends { id: string; date: string }>(
  records: readonly T[],
  today = new Date(),
  limit = RECENT_LIMIT,
): HeroItem<T>[] {
  const anniversaries: HeroItem<T>[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const d = new Date(record.date);
    if (
      d.getFullYear() < today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    ) {
      anniversaries.push({
        record,
        yearsAgo: today.getFullYear() - d.getFullYear(),
      });
      seen.add(record.id);
    }
  }
  const recent = records
    .filter((record) => !seen.has(record.id))
    .slice(0, limit)
    .map((record) => ({ record }));
  return [...anniversaries, ...recent];
}
