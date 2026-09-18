/** 年度重放选片：纯本地，每月封面 + 全部「第一次」，按日期升序、上限 15 张。 */
import {
  monthKey,
  recordTitle,
  type LocalMedia,
  type LocalRecord,
  type Stored,
} from "./model";

export const REPLAY_LIMIT = 15;

export type ReplaySlide = {
  mediaId: string;
  caption: string;
  date: string;
};

/** 一条记录的封面图：优先记录封面，再取第一张图片素材。 */
function coverIdOf(
  record: Stored<LocalRecord>,
  media: Record<string, LocalMedia>,
): string | undefined {
  if (record.coverId && media[record.coverId]?.kind === "image")
    return record.coverId;
  return record.mediaIds.find((id) => media[id]?.kind === "image");
}

/** 全部「第一次」的封面先进片，再按月补封面（同图去重、每月一张）。 */
export function replayPhotos(
  records: Stored<LocalRecord>[],
  media: Record<string, LocalMedia>,
): ReplaySlide[] {
  const byDate = [...records].sort((a, b) => a.date.localeCompare(b.date));
  const used = new Set<string>();
  const slides: ReplaySlide[] = [];
  const push = (record: Stored<LocalRecord>, mediaId: string) => {
    used.add(mediaId);
    slides.push({
      mediaId,
      caption: recordTitle(record),
      date: record.date,
    });
  };
  for (const record of byDate) {
    if (!record.first) continue;
    const mediaId = coverIdOf(record, media);
    if (mediaId && !used.has(mediaId)) push(record, mediaId);
  }
  const coveredMonths = new Set<string>();
  for (const record of byDate) {
    const month = monthKey(record.date);
    if (coveredMonths.has(month)) continue;
    const mediaId = coverIdOf(record, media);
    if (!mediaId) continue;
    coveredMonths.add(month);
    if (!used.has(mediaId)) push(record, mediaId);
  }
  return slides
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, REPLAY_LIMIT);
}
