import { yearKey, type LocalRecord, type Stored, compareDates } from "./model";

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
  return `${record.title}\n${record.text}\n${record.location}`
    .toLowerCase()
    .includes(query.toLowerCase());
}

/** 全库搜索：标题/正文/地点不区分大小写包含 + 可选筛选，按日期倒序，最多 100 条。 */
export function searchRecords(
  records: Stored<LocalRecord>[],
  query: string,
  filters: SearchFilters = {},
  kinds: Record<string, string> = {},
): Stored<LocalRecord>[] {
  const needle = query.trim().toLowerCase();
  const media = filters.media ?? "any";
  return records
    .filter((r) => {
      if (filters.first && !r.first) return false;
      if (filters.quote && !r.quote) return false;
      if (filters.year && yearKey(r.date) !== filters.year) return false;
      if (filters.person && !r.personIds?.includes(filters.person))
        return false;
      if (filters.by && r.by !== filters.by) return false;
      if (media === "av" && !hasAV(r, kinds)) return false;
      if (media === "none" && r.mediaIds.length) return false;
      return recordMatches(r, needle);
    })
    .sort((a, b) => compareDates(b.date, a.date) || a.id.localeCompare(b.id))
    .slice(0, 100);
}
