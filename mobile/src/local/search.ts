import { yearKey, type LocalRecord } from "./model";

export type MediaFilter = "any" | "av" | "none";
export type SearchFilters = {
  first?: boolean;
  media?: MediaFilter;
  year?: string;
  person?: string;
};

function hasAV(record: LocalRecord, kinds: Record<string, string>): boolean {
  return record.mediaIds.some((id) => {
    const kind = kinds[id];
    return kind === "video" || kind === "audio";
  });
}

/** 全库搜索：标题/正文/地点不区分大小写包含 + 可选筛选，按日期倒序，最多 100 条。 */
export function searchRecords(
  records: LocalRecord[],
  query: string,
  filters: SearchFilters = {},
  kinds: Record<string, string> = {},
): LocalRecord[] {
  const needle = query.trim().toLowerCase();
  const media = filters.media ?? "any";
  return records
    .filter((r) => {
      if (filters.first && !r.first) return false;
      if (filters.year && yearKey(r.date) !== filters.year) return false;
      if (filters.person && !r.personIds?.includes(filters.person))
        return false;
      if (media === "av" && !hasAV(r, kinds)) return false;
      if (media === "none" && r.mediaIds.length) return false;
      if (!needle) return true;
      return `${r.title}\n${r.text}\n${r.location}`
        .toLowerCase()
        .includes(needle);
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    .slice(0, 100);
}
