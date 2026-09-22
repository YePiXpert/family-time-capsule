/** 年度纸书的内容装配：封面、寄语、按月记录、第一次与落款。 */
import type { YearPicks } from "./model";
import { CHILD_FALLBACK } from "./brand";
import type { BookBlock, BookChapter, BookInput, BookPhoto } from "./book";

/** 成册用的一年：照月分章，每条记录先文字后照片，清单与寄语都不再截断。 */
export type YearBookSource = {
  year: string;
  title?: string;
  profileName: string;
  fullName?: string;
  motto?: string;
  birthday?: string;
  stats: string;
  note: string;
  months: {
    label: string;
    lead?: string;
    records: {
      title: string;
      date: string;
      text: string;
      /** 落款（谁写的）。 */
      by?: string;
      photos: BookPhoto[];
    }[];
  }[];
  firsts: { title: string; date: string }[];
  cover?: BookPhoto;
  colophon: string;
};

/** 每月按目录顺序选材；没收进目录的月照旧全收。 */
export function yearBookMonth<T extends { id: string }>(
  records: readonly T[],
  selection: YearPicks["months"][string] | undefined,
  bookRecord: (record: T) => YearBookSource["months"][number]["records"][number],
) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const selected = selection
    ? selection.recordIds.flatMap((id) => { const r = byId.get(id); return r ? [r] : []; })
    : records;
  const content = selected.map(bookRecord);
  const shots = content.reduce((n, r) => n + r.photos.length, 0);
  const stats = [`${content.length} 段时光`, shots ? `${shots} 张照片` : ""].filter(Boolean).join(" · ");
  return {
    lead: [selection?.quote ? `「${selection.quote.text}」` : "", stats].filter(Boolean).join("\n"),
    records: content,
  };
}

function recordBlocks(
  records: YearBookSource["months"][number]["records"],
): BookBlock[] {
  const blocks: BookBlock[] = [];
  for (const record of records) {
    const title = record.title.trim();
    const text = record.text.trim();
    if (title || text)
      blocks.push({
        kind: "text",
        ...(title ? { title } : {}),
        date: record.date,
        body: text,
        ...(record.by ? { by: record.by } : {}),
      });
    if (record.photos.length)
      blocks.push({ kind: "photos", photos: record.photos });
  }
  return blocks;
}

export function yearBookInput(source: YearBookSource): BookInput {
  const nick = source.profileName.trim();
  const name = nick || CHILD_FALLBACK;
  const chapters: BookChapter[] = [];
  const note = source.note.trim();
  if (note)
    chapters.push({
      heading: "爸爸妈妈的话",
      blocks: [{ kind: "text", body: note }],
    });
  for (const month of source.months) {
    const blocks = recordBlocks(month.records);
    if (blocks.length)
      chapters.push({
        heading: month.label,
        ...(month.lead ? { lead: month.lead } : {}),
        blocks,
      });
  }
  if (source.firsts.length)
    chapters.push({
      heading: "这一年的第一次",
      blocks: [{ kind: "list", entries: source.firsts }],
    });
  return {
    title: source.title?.trim() || `${name}的 ${source.year} 年`,
    subtitle: source.title?.trim() ? `${name}的 ${source.year} 年 · ${source.stats}` : source.stats,
    stamp: source.year,
    ...(source.cover ? { cover: source.cover } : {}),
    titlePage: {
      name: nick || source.fullName || name,
      ...(nick && source.fullName ? { fullName: source.fullName } : {}),
      ...(source.motto ? { motto: source.motto } : {}),
      ...(source.birthday ? { birthday: source.birthday } : {}),
    },
    chapters,
    colophon: source.colophon,
  };
}
