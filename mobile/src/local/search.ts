import { newestFirst, yearKey, type LocalRecord, type Stored } from "./model";

export type MediaFilter = "any" | "av" | "none";
export type SearchFilters = {
  first?: boolean;
  quote?: boolean;
  media?: MediaFilter;
  year?: string;
  person?: string;
  /** 落款：只看这个人写的。 */
  by?: string;
};

function hasAV(
  record: Stored<LocalRecord>,
  kinds: Record<string, string>,
): boolean {
  return record.mediaIds.some((id) => {
    const kind = kinds[id];
    return kind === "video" || kind === "audio";
  });
}

/** 单条记录的检索谓词：标题/正文/地点不区分大小写包含；空关键词一律命中。
 * 全库搜索与月册内搜索共用；月册走这里，不带全库的 100 条截断。 */
export function recordMatches(
  record: Stored<LocalRecord>,
  query: string,
): boolean {
  if (!query) return true;
  return haystackOf(record).includes(query.toLowerCase());
}
/** 记录冻结后不会再变：小写后的检索文本按记录对象记住，每敲一个字不必把全库再小写一遍。 */
const haystacks = new WeakMap<object, string>();
function haystackOf(record: Stored<LocalRecord>): string {
  const cached = haystacks.get(record);
  if (cached !== undefined) return cached;
  const text = `${record.title}\n${record.text}\n${record.location}`.toLowerCase();
  if (Object.isFrozen(record)) haystacks.set(record, text);
  return text;
}

/** 一次列出的结果上限；再多就提示加筛选。 */
export const SEARCH_LIMIT = 100;
/** 全库搜索：标题/正文/地点不区分大小写包含 + 可选筛选，按日期倒序，最多 limit 条。 */
export function searchRecords(
  records: readonly Stored<LocalRecord>[],
  query: string,
  filters: SearchFilters = {},
  kinds: Record<string, string> = {},
  limit = SEARCH_LIMIT,
): Stored<LocalRecord>[] {
  return searchSortedRecords(newestFirst(records), query, filters, kinds, limit);
}
/** 同上，但 records 已按 sortedRecords 的次序排好（搜索页用缓存的那份）：顺着走，够数就停。 */
export function searchSortedRecords(
  records: readonly Stored<LocalRecord>[],
  query: string,
  filters: SearchFilters = {},
  kinds: Record<string, string> = {},
  limit = SEARCH_LIMIT,
): Stored<LocalRecord>[] {
  const needle = query.trim().toLowerCase();
  const media = filters.media ?? "any";
  const found: Stored<LocalRecord>[] = [];
  for (const r of records) {
    if (found.length >= limit) break;
    if (filters.first && !r.first) continue;
    if (filters.quote && !r.quote) continue;
    if (filters.year && yearKey(r.date) !== filters.year) continue;
    if (filters.person && !r.personIds?.includes(filters.person)) continue;
    if (filters.by && r.by !== filters.by) continue;
    if (media === "av" && !hasAV(r, kinds)) continue;
    if (media === "none" && r.mediaIds.length) continue;
    if (recordMatches(r, needle)) found.push(r);
  }
  return found;
}
