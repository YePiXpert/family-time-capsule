/** Pure layout for the exportable keepsake card: wrap, geometry and data-URL plumbing. */

export const CARD_WIDTH = 750;
const PADDING = 48;
const CONTENT_W = CARD_WIDTH - PADDING * 2;

/** 估算一个字符的显示宽度：全角约等于字号，半角约 0.55 倍。 */
function charWidth(ch: string, fontSize: number): number {
  if (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(ch))
    return fontSize;
  if (ch === " ") return fontSize * 0.3;
  return fontSize * 0.55;
}

export function wrapText(
  text: string,
  { fontSize, maxWidth, maxLines }: { fontSize: number; maxWidth: number; maxLines: number },
): string[] {
  const all: string[] = [];
  for (const paragraph of text.replace(/\r/g, "").split("\n")) {
    let current = "",
      width = 0;
    const push = () => {
      all.push(current);
      current = "";
      width = 0;
    };
    for (const ch of paragraph) {
      const w = charWidth(ch, fontSize);
      if (width + w > maxWidth && current) push();
      current += ch;
      width += w;
    }
    push();
  }
  if (all.length <= maxLines) return all;
  const lines = all.slice(0, maxLines);
  const room = maxWidth - 2 * charWidth("…", fontSize);
  let last = lines[maxLines - 1]!,
    width = [...last].reduce((n, ch) => n + charWidth(ch, fontSize), 0);
  while (width > room && last) {
    last = [...last].slice(0, -1).join("");
    width = [...last].reduce((n, ch) => n + charWidth(ch, fontSize), 0);
  }
  lines[maxLines - 1] = `${last}…`;
  return lines;
}

export type KeepSakeLayout = {
  width: number;
  height: number;
  dateY: number;
  ornamentTopY: number;
  photo: { x: number; y: number; w: number; h: number } | null;
  titleLines: { y: number; text: string }[];
  bodyLines: { y: number; text: string }[];
  locationY: number | null;
  ornamentBottomY: number;
  footerY: number;
};
export type KeepSakeInput = {
  date: string;
  title: string;
  text: string;
  location?: string;
  /** 照片宽高比（w/h）；无照片省略。 */
  photoAspect?: number;
};

export function layoutKeepSake(input: KeepSakeInput): KeepSakeLayout {
  let y = PADDING + 26;
  const dateY = y;
  y += 26 + 24;
  const ornamentTopY = y;
  y += 30;
  let photo: KeepSakeLayout["photo"] = null;
  if (input.photoAspect && input.photoAspect > 0) {
    const h = Math.min(
      Math.max(CONTENT_W / input.photoAspect, CONTENT_W * 0.6),
      CONTENT_W * 1.2,
    );
    photo = { x: PADDING, y, w: CONTENT_W, h };
    y += h + 40;
  }
  const titleLines = wrapText(input.title, {
    fontSize: 40,
    maxWidth: CONTENT_W,
    maxLines: 2,
  }).map((text, i) => ({ y: y + i * 54, text }));
  if (titleLines.length) y += titleLines.length * 54 + 12;
  const bodyLines = wrapText(input.text, {
    fontSize: 26,
    maxWidth: CONTENT_W,
    maxLines: 9,
  }).map((text, i) => ({ y: y + i * 40, text }));
  if (bodyLines.length) y += bodyLines.length * 40 + 16;
  let locationY: number | null = null;
  if (input.location?.trim()) {
    locationY = y;
    y += 34;
  }
  const height = Math.max(Math.ceil(y + 90 + PADDING), 1000);
  const ornamentBottomY = height - PADDING - 72;
  const footerY = height - PADDING - 30;
  return {
    width: CARD_WIDTH,
    height,
    dateY,
    ornamentTopY,
    photo,
    titleLines,
    bodyLines,
    locationY,
    ornamentBottomY,
    footerY,
  };
}

export const SERIES_STRIP_MAX = 4;

/** 超过上限时均匀抽样（保留首尾），让对比条覆盖整段时间线。 */
export function sampledIndices(count: number, cap: number): number[] {
  if (count <= cap) return Array.from({ length: count }, (_, i) => i);
  return Array.from(
    { length: cap },
    (_, k) => Math.round((k * (count - 1)) / (cap - 1)),
  );
}

export type SeriesStripLayout = {
  width: number;
  height: number;
  titleY: number;
  ornamentTopY: number;
  cells: {
    x: number;
    y: number;
    w: number;
    h: number;
    month: string;
    labelY: number;
  }[];
  ornamentBottomY: number;
  footerY: number;
};

const CELL_HEIGHT = 440;
const CELL_GAP = 18;

/** 时光系列对比条：横排 3-4 张、月份标签、固定版面；几何只看张数，不看缺哪个月。 */
export function layoutSeriesStrip(
  items: { month: string }[],
): SeriesStripLayout {
  const height = 840;
  const titleY = PADDING + 36;
  const ornamentTopY = titleY + 40;
  const top = ornamentTopY + 54;
  const picked = sampledIndices(items.length, SERIES_STRIP_MAX).map(
    (i) => items[i]!,
  );
  const n = picked.length;
  const w = n ? (CONTENT_W - CELL_GAP * (n - 1)) / n : CONTENT_W;
  return {
    width: CARD_WIDTH,
    height,
    titleY,
    ornamentTopY,
    cells: picked.map((item, i) => ({
      x: PADDING + i * (w + CELL_GAP),
      y: top,
      w,
      h: CELL_HEIGHT,
      month: item.month,
      labelY: top + CELL_HEIGHT + 36,
    })),
    ornamentBottomY: height - PADDING - 72,
    footerY: height - PADDING - 30,
  };
}

/** toDataURL 的回调在 iOS 给完整 data URL，Android 只给裸 base64；两者都收。 */export function pngBytesOfDataUrl(dataUrl: string): Uint8Array {
  const trimmed = dataUrl.trim();
  const comma = trimmed.indexOf(",");
  const payload = comma >= 0 ? trimmed.slice(comma + 1) : trimmed;
  if (
    comma >= 0 &&
    !/^data:image\/png;base64,$/.test(trimmed.slice(0, comma + 1))
  )
    throw new Error("纪念卡生成失败，请重试。");
  const bytes = base64ToBytes(payload);
  // PNG 魔数，防止把别的格式当图片写盘。
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50)
    throw new Error("纪念卡生成失败，请重试。");
  return bytes;
}

export function base64ToBytes(value: string): Uint8Array {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Map([...alphabet].map((c, i) => [c, i]));
  const clean = value.replace(/[\r\n=]+/g, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let out = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].map((k) => lookup.get(clean[i + k] ?? "") ?? 0);
    const triple = (n[0]! << 18) | (n[1]! << 12) | (n[2]! << 6) | n[3]!;
    const usable = Math.min(3, clean.length - i - 1);
    for (let b = 0; b < usable; b++)
      bytes[out++] = (triple >> (16 - 8 * b)) & 0xff;
  }
  return bytes.subarray(0, out);
}
