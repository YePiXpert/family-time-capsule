/** 年度成长册的纯排版：封面、寄语、十二月网格、第一次、落款，固定 750 宽长卷。 */
import { wrapText } from "./keepsake";
import { CHILD_FALLBACK } from "./brand";

export const YEARBOOK_WIDTH = 750;
const PADDING = 48;
const CONTENT_W = YEARBOOK_WIDTH - PADDING * 2;
const ORNAMENT_GAP = 34;
export const MONTH_COLUMNS = 4;
const MONTH_GAP = 18;
const MONTH_CELL = (CONTENT_W - MONTH_GAP * (MONTH_COLUMNS - 1)) / MONTH_COLUMNS;
const MONTH_CELL_H = MONTH_CELL;
const MONTH_LABEL_H = 56;
export const YEARBOOK_MAX_FIRSTS = 8;
/** SVG 渲染的可承受高度上限；内容更多时从这里截断。 */
export const YEARBOOK_MAX_HEIGHT = 6000;

export type YearbookMonth = {
  /** 已格式化的月份标签，如「2026年3月」。 */
  label: string;
  count: number;
  /** 有封面照时给出宽高比（w/h）。 */
  photoAspect?: number;
};

export type YearbookInput = {
  year: string;
  profileName: string;
  /** 已组装的统计一行。 */
  stats: string;
  note: string;
  months: YearbookMonth[];
  firsts: { title: string; date: string }[];
  colophon: string;
  coverAspect?: number;
};

export type YearbookLayout = {
  width: number;
  height: number;
  stamp: { cx: number; cy: number; r: number };
  titleLines: { y: number; text: string }[];
  statsY: number | null;
  coverPhoto: { x: number; y: number; w: number; h: number } | null;
  ornaments: number[];
  noteHeadingY: number | null;
  noteLines: { y: number; text: string }[];
  monthsHeadingY: number | null;
  cells: {
    x: number;
    y: number;
    w: number;
    h: number;
    label: string;
    count: number;
    labelY: number;
    countY: number;
    hasPhoto: boolean;
  }[];
  firstsHeadingY: number | null;
  firsts: { y: number; title: string; date: string }[];
  colophonY: number;
};

export function layoutYearbook(input: YearbookInput): YearbookLayout {
  const ornaments: number[] = [];
  let y = PADDING + 24;

  const r = 64;
  const stamp = { cx: YEARBOOK_WIDTH / 2, cy: y + r, r };
  y += r * 2 + 30;

  const name = input.profileName.trim() || CHILD_FALLBACK;
  const titleLines = wrapText(`${name}的 ${input.year} 年`, {
    fontSize: 40,
    maxWidth: CONTENT_W,
    maxLines: 2,
  }).map((text, i) => ({ y: y + i * 54, text }));
  y += titleLines.length * 54 + 10;

  let statsY: number | null = null;
  if (input.stats.trim()) {
    statsY = y;
    y += 34;
  }

  let coverPhoto: YearbookLayout["coverPhoto"] = null;
  if (input.coverAspect && input.coverAspect > 0) {
    const h = Math.min(
      Math.max(CONTENT_W / input.coverAspect, 320),
      CONTENT_W * 0.8,
    );
    coverPhoto = { x: PADDING, y, w: CONTENT_W, h };
    y += h + ORNAMENT_GAP;
  }
  ornaments.push(y);
  y += ORNAMENT_GAP + 12;

  let noteHeadingY: number | null = null;
  const noteLines: { y: number; text: string }[] = [];
  const note = input.note.trim();
  if (note) {
    noteHeadingY = y;
    y += 40;
    for (const line of wrapText(note, {
      fontSize: 24,
      maxWidth: CONTENT_W,
      maxLines: 14,
    })) {
      noteLines.push({ y, text: line });
      y += 36;
    }
    y += 12;
    ornaments.push(y);
    y += ORNAMENT_GAP + 12;
  }

  let monthsHeadingY: number | null = null;
  const cells: YearbookLayout["cells"] = [];
  if (input.months.length) {
    monthsHeadingY = y;
    y += 46;
    input.months.forEach((month, index) => {
      const column = index % MONTH_COLUMNS;
      const row = Math.floor(index / MONTH_COLUMNS);
      const x = PADDING + column * (MONTH_CELL + MONTH_GAP);
      const cellY = y + row * (MONTH_CELL_H + MONTH_LABEL_H + 8);
      const labelY = cellY + MONTH_CELL_H + 26;
      cells.push({
        x,
        y: cellY,
        w: MONTH_CELL,
        h: MONTH_CELL_H,
        label: month.label,
        count: month.count,
        labelY,
        countY: labelY + 24,
        hasPhoto: !!month.photoAspect,
      });
    });
    const rows = Math.ceil(input.months.length / MONTH_COLUMNS);
    y += rows * (MONTH_CELL_H + MONTH_LABEL_H + 8) + 14;
    ornaments.push(y);
    y += ORNAMENT_GAP + 12;
  }

  let firstsHeadingY: number | null = null;
  const firsts: YearbookLayout["firsts"] = [];
  const entries = input.firsts.slice(0, YEARBOOK_MAX_FIRSTS);
  if (entries.length) {
    firstsHeadingY = y;
    y += 46;
    for (const entry of entries) {
      firsts.push({ y, title: entry.title, date: entry.date });
      y += 34 + 30 + 12;
    }
    y += 6;
    ornaments.push(y);
    y += ORNAMENT_GAP + 12;
  }

  const colophonY = y + 10;
  y += 60;

  return {
    width: YEARBOOK_WIDTH,
    height: Math.min(Math.max(Math.ceil(y + PADDING), 1000), YEARBOOK_MAX_HEIGHT),
    stamp,
    titleLines,
    statsY,
    coverPhoto,
    ornaments,
    noteHeadingY,
    noteLines,
    monthsHeadingY,
    cells,
    firstsHeadingY,
    firsts,
    colophonY,
  };
}
