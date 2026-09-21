import {
  monthKey,
  type LocalMedia,
  type LocalRecord,
  type Stored,
} from "./model";

export type YearRecap = {
  months: { month: string; count: number; cover?: LocalMedia }[];
  firsts: Stored<LocalRecord>[];
  photos: number;
  av: number;
  chars: number;
  /** 谁写了几段，多的在前；没落款的不算。 */
  byCounts: { by: string; count: number }[];
};

/** 按落款数段数：多的在前，同数按称呼 zh 排。 */
export function byCountsOf(
  records: readonly Stored<LocalRecord>[],
): { by: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of records) if (r.by) counts.set(r.by, (counts.get(r.by) ?? 0) + 1);
  return [...counts.entries()]
    .map(([by, count]) => ({ by, count }))
    .sort((a, b) => b.count - a.count || a.by.localeCompare(b.by, "zh"));
}
/** 「爸爸写了 12 段 · 妈妈写了 8 段」；没人落款就是空串。 */
export function byLine(byCounts: readonly { by: string; count: number }[]): string {
  return byCounts.map(({ by, count }) => `${by}写了 ${count} 段`).join(" · ");
}

/** 年度回顾的纯汇总：各月封面、第一次清单、照片/影音/字数统计。 */
export function recapOf(
  records: Stored<LocalRecord>[],
  media: Record<string, LocalMedia>,
): YearRecap {
  const byMonth = new Map<string, Stored<LocalRecord>[]>();
  for (const record of records) {
    const key = monthKey(record.date);
    const list = byMonth.get(key) ?? [];
    list.push(record);
    byMonth.set(key, list);
  }
  const coverOf = (list: Stored<LocalRecord>[]): Stored<LocalMedia> | undefined => {
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
    byCounts: byCountsOf(records),
  };
}
