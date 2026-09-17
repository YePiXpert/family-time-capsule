import {
  monthKey,
  type LocalMedia,
  type LocalRecord,
} from "./model";

export type YearRecap = {
  months: { month: string; count: number; cover?: LocalMedia }[];
  firsts: LocalRecord[];
  photos: number;
  av: number;
  chars: number;
};

/** 年度回顾的纯汇总：各月封面、第一次清单、照片/影音/字数统计。 */
export function recapOf(
  records: LocalRecord[],
  media: Record<string, LocalMedia>,
): YearRecap {
  const byMonth = new Map<string, LocalRecord[]>();
  for (const record of records) {
    const key = monthKey(record.date);
    const list = byMonth.get(key) ?? [];
    list.push(record);
    byMonth.set(key, list);
  }
  const coverOf = (list: LocalRecord[]): LocalMedia | undefined => {
    for (const r of list) {
      const candidate = r.coverId ? media[r.coverId] : undefined;
      if (candidate?.kind === "image") return candidate;
      const first = r.mediaIds.map((id) => media[id]).find((m) => m?.kind === "image");
      if (first) return first;
    }
    return undefined;
  };
  const kindOf = (id: string) => media[id]?.kind;
  return {
    months: [...byMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, list]) => ({ month, count: list.length, cover: coverOf(list) })),
    firsts: records
      .filter((r) => r.first)
      .sort((a, b) => a.date.localeCompare(b.date)),
    photos: records.reduce(
      (n, r) =>
        n + r.mediaIds.filter((id) => kindOf(id) === "image").length,
      0,
    ),
    av: records.reduce(
      (n, r) =>
        n +
        r.mediaIds.filter((id) => {
          const kind = kindOf(id);
          return kind === "video" || kind === "audio";
        }).length,
      0,
    ),
    chars: records.reduce(
      (n, r) => n + r.title.trim().length + r.text.trim().length,
      0,
    ),
  };
}
