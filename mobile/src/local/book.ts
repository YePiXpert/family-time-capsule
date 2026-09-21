/**
 * 可送印纪念册的纯排版：把一年（或一本相册）的内容排进真正的页，而不是切长图。
 *
 * 单位一律用 pt（1pt = 1/72 英寸），渲染时再乘 SCALE 取图，所以版面与分辨率无关。
 * 开本 200×200mm，四周各留 3mm 出血：坐标原点在出血纸的左上角，成品边在 BLEED 处，
 * 文字一律待在安全框内，只有满版照片可以压到出血边。
 *
 * 照片版位的取舍：单张按真实宽高比放，多张走固定方格并居中裁切——这是照片书的常规,
 * 也让页高不随素材比例漂移。
 */
import { wrapAll } from "./keepsake";
import { fullNameLine } from "./model";

const MM = 72 / 25.4;
/** 成品边长。 */
export const TRIM_PT = 200 * MM;
export const BLEED_PT = 3 * MM;
/** 含出血的整张纸。 */
export const SHEET_PT = TRIM_PT + BLEED_PT * 2;
/** 300 DPI 下一张纸的像素边长。 */
export const SCALE = 300 / 72;
export const SHEET_PX = Math.round(SHEET_PT * SCALE);

const MARGIN = 12 * MM;
const LEFT = BLEED_PT + MARGIN;
const TOP = BLEED_PT + MARGIN;
const RIGHT = BLEED_PT + TRIM_PT - MARGIN;
const BOTTOM = BLEED_PT + TRIM_PT - MARGIN;
const CONTENT_W = RIGHT - LEFT;
const GAP = 6 * MM;
const FOLIO_Y = BLEED_PT + TRIM_PT - 7 * MM;

const TITLE_SIZE = 30;
const HEADING_SIZE = 22;
const LEAD_SIZE = 11;
const RECORD_SIZE = 14;
const BODY_SIZE = 10.5;
const BODY_LEADING = 16;
const CAPTION_SIZE = 8;
const META_SIZE = 9;
const FOLIO_SIZE = 8;

export type BookPhoto = { key: string; aspect: number };
export type BookBlock =
  | { kind: "photos"; photos: BookPhoto[]; captions?: (string | undefined)[] }
  | { kind: "text"; title?: string; date?: string; body: string; by?: string }
  | { kind: "list"; entries: { title: string; date: string }[] };
export type BookChapter = { heading: string; lead?: string; blocks: BookBlock[] };
export type BookInput = {
  title: string;
  subtitle?: string;
  /** 印章里的字：年份或名字首字。 */
  stamp: string;
  cover?: BookPhoto;
  titlePage?: { name: string; birthday?: string; fullName?: string; motto?: string };
  chapters: BookChapter[];
  colophon: string;
};

export type BookElement =
  | { kind: "photo"; key: string; x: number; y: number; w: number; h: number }
  | {
      kind: "text";
      text: string;
      x: number;
      y: number;
      size: number;
      align: "left" | "center" | "right";
      serif: boolean;
      tone: "body" | "muted" | "accent";
    }
  | { kind: "stamp"; cx: number; cy: number; r: number; text: string }
  /** 满版封面上垫在书名底下的纸色横带：照片深一点，黑字就读不出来了。 */
  | { kind: "scrim"; y: number; h: number }
  | { kind: "ornament"; y: number }
  | { kind: "rule"; y: number };
export type BookPageKind =
  | "cover"
  | "title"
  | "chapter"
  | "content"
  | "colophon";
export type BookPage = {
  kind: BookPageKind;
  /** 页码；封面与扉页不排。 */
  folio: number | null;
  /** 满版照片压到出血边，这一页不铺纸色。 */
  fullBleed: boolean;
  elements: BookElement[];
};
export type BookLayout = {
  sheet: number;
  trim: number;
  bleed: number;
  pages: BookPage[];
};

const text = (
  value: string,
  x: number,
  y: number,
  size: number,
  options: Partial<Pick<Extract<BookElement, { kind: "text" }>, "align" | "serif" | "tone">> = {},
): BookElement => ({
  kind: "text",
  text: value,
  x,
  y,
  size,
  align: options.align ?? "left",
  serif: options.serif ?? false,
  tone: options.tone ?? "body",
});

/** 一页在排的状态：元素清单加一支自上而下的游标。 */
class Sheet {
  elements: BookElement[] = [];
  y = TOP;
  constructor(readonly kind: BookPageKind) {}
  get room() {
    return BOTTOM - this.y;
  }
}

/** 多图方格：两列，格子是正方形，宽和页高谁先到顶就听谁的——带图注的四宫格
 *  按宽算会正好超出安全框一截。 */
function grid(count: number, captioned: boolean) {
  const captionRoom = captioned ? CAPTION_SIZE + 6 : 0;
  const rows = count <= 2 ? 1 : 2;
  const columns = 2;
  const byWidth = (CONTENT_W - GAP) / columns;
  const byHeight = (BOTTOM - TOP - (rows - 1) * GAP) / rows - captionRoom;
  const cell = Math.min(byWidth, byHeight);
  return {
    rows,
    cell,
    captionRoom,
    height: rows * (cell + captionRoom) + (rows - 1) * GAP,
    x0: LEFT + (CONTENT_W - (columns * cell + GAP)) / 2,
  };
}

/** 一组照片（1–4 张）占多高，含图注。 */
function groupHeight(photos: BookPhoto[], captioned: boolean) {
  if (photos.length === 1) {
    const captionRoom = captioned ? CAPTION_SIZE + 6 : 0;
    const aspect = photos[0]!.aspect > 0 ? photos[0]!.aspect : 4 / 3;
    return Math.min(CONTENT_W / aspect, BOTTOM - TOP - captionRoom) + captionRoom;
  }
  return grid(photos.length, captioned).height;
}

function placeGroup(
  sheet: Sheet,
  photos: BookPhoto[],
  captions: (string | undefined)[],
) {
  const captioned = captions.some((c) => !!c);
  if (photos.length === 1) {
    const captionRoom = captioned ? CAPTION_SIZE + 6 : 0;
    const aspect = photos[0]!.aspect > 0 ? photos[0]!.aspect : 4 / 3;
    const h = Math.min(CONTENT_W / aspect, BOTTOM - sheet.y - captionRoom);
    const w = Math.min(CONTENT_W, h * aspect);
    const x = LEFT + (CONTENT_W - w) / 2;
    sheet.elements.push({ kind: "photo", key: photos[0]!.key, x, y: sheet.y, w, h });
    if (captions[0])
      sheet.elements.push(
        text(captions[0]!, LEFT + CONTENT_W / 2, sheet.y + h + CAPTION_SIZE + 2, CAPTION_SIZE, {
          align: "center",
          tone: "muted",
        }),
      );
    sheet.y += h + captionRoom;
    return;
  }
  const { cell, captionRoom, height, x0 } = grid(photos.length, captioned);
  photos.forEach((photo, index) => {
    const x = x0 + (index % 2) * (cell + GAP);
    const y = sheet.y + Math.floor(index / 2) * (cell + captionRoom + GAP);
    sheet.elements.push({ kind: "photo", key: photo.key, x, y, w: cell, h: cell });
    if (captions[index])
      sheet.elements.push(
        text(captions[index]!, x + cell / 2, y + cell + CAPTION_SIZE + 2, CAPTION_SIZE, {
          align: "center",
          tone: "muted",
        }),
      );
  });
  sheet.y += height;
}

export function layoutBook(input: BookInput): BookLayout {
  const pages: BookPage[] = [];
  let folio = 0;
  const middle = BLEED_PT + TRIM_PT / 2;

  const commit = (sheet: Sheet, fullBleed = false) => {
    const numbered = sheet.kind === "chapter" || sheet.kind === "content";
    if (numbered) folio += 1;
    if (numbered)
      sheet.elements.push(
        text(String(folio), middle, FOLIO_Y, FOLIO_SIZE, {
          align: "center",
          tone: "muted",
        }),
      );
    pages.push({
      kind: sheet.kind,
      folio: numbered ? folio : null,
      fullBleed,
      elements: sheet.elements,
    });
  };

  // 封面：有照片就整页满版压到出血边，没有就走纸面加印章。
  const cover = new Sheet("cover");
  if (input.cover) {
    cover.elements.push({
      kind: "photo",
      key: input.cover.key,
      x: 0,
      y: 0,
      w: SHEET_PT,
      h: SHEET_PT,
    });
    const band = BLEED_PT + TRIM_PT - 40 * MM;
    cover.elements.push({ kind: "scrim", y: band, h: SHEET_PT - band });
    cover.elements.push(
      text(input.title, middle, BLEED_PT + TRIM_PT - 24 * MM, TITLE_SIZE, {
        align: "center",
        serif: true,
      }),
    );
  } else {
    cover.elements.push({
      kind: "stamp",
      cx: middle,
      cy: BLEED_PT + TRIM_PT * 0.38,
      r: 21 * MM,
      text: input.stamp,
    });
    cover.elements.push(
      text(input.title, middle, BLEED_PT + TRIM_PT * 0.62, TITLE_SIZE, {
        align: "center",
        serif: true,
      }),
    );
    cover.elements.push({ kind: "ornament", y: BLEED_PT + TRIM_PT * 0.7 });
  }
  commit(cover, !!input.cover);

  // 扉页
  const title = new Sheet("title");
  title.elements.push({
    kind: "stamp",
    cx: middle,
    cy: BLEED_PT + TRIM_PT * 0.34,
    r: 15 * MM,
    text: input.stamp,
  });
  title.elements.push(
    text(input.titlePage?.name || input.titlePage?.fullName || input.title, middle, BLEED_PT + TRIM_PT * 0.52, HEADING_SIZE, {
      align: "center",
      serif: true,
    }),
  );
  const hasNameStory = !!(input.titlePage?.fullName || input.titlePage?.motto);
  const nameLine = input.titlePage?.name && input.titlePage.fullName
    ? fullNameLine(input.titlePage.fullName, input.titlePage.name)
    : "";
  if (nameLine)
    title.elements.push(
      text(nameLine, middle, BLEED_PT + TRIM_PT * 0.575, META_SIZE, {
        align: "center",
        tone: "muted",
      }),
    );
  if (input.titlePage?.motto)
    title.elements.push(
      text(input.titlePage.motto, middle, BLEED_PT + TRIM_PT * 0.615, META_SIZE + 1, {
        align: "center",
        serif: true,
        tone: "muted",
      }),
    );
  if (input.titlePage?.birthday)
    title.elements.push(
      text(input.titlePage.birthday, middle, BLEED_PT + TRIM_PT * (hasNameStory ? 0.66 : 0.58), META_SIZE, {
        align: "center",
        tone: "muted",
      }),
    );
  if (input.subtitle)
    title.elements.push(
      text(input.subtitle, middle, BLEED_PT + TRIM_PT * (hasNameStory ? 0.705 : 0.63), META_SIZE, {
        align: "center",
        tone: "muted",
      }),
    );
  title.elements.push({ kind: "ornament", y: BLEED_PT + TRIM_PT * (hasNameStory ? 0.76 : 0.7) });
  commit(title);

  for (const chapter of input.chapters) {
    // 章节页：大字标题加一句引子，起新页。
    const head = new Sheet("chapter");
    head.y = BLEED_PT + TRIM_PT * 0.38;
    head.elements.push(
      text(chapter.heading, middle, head.y, HEADING_SIZE, {
        align: "center",
        serif: true,
      }),
    );
    head.y += HEADING_SIZE + 10;
    if (chapter.lead) {
      for (const line of wrapAll(chapter.lead, LEAD_SIZE, CONTENT_W * 0.8)) {
        head.elements.push(
          text(line, middle, head.y, LEAD_SIZE, { align: "center", tone: "muted" }),
        );
        head.y += LEAD_SIZE + 6;
      }
    }
    head.elements.push({ kind: "ornament", y: head.y + 8 });
    commit(head);

    let sheet = new Sheet("content");
    const turn = () => {
      commit(sheet);
      sheet = new Sheet("content");
    };

    for (const block of chapter.blocks) {
      if (block.kind === "photos") {
        const captions = block.captions ?? [];
        for (let at = 0; at < block.photos.length; at += 4) {
          const group = block.photos.slice(at, at + 4);
          const slice = captions.slice(at, at + 4);
          const needed = groupHeight(group, slice.some((c) => !!c));
          if (sheet.elements.length && needed > sheet.room) turn();
          placeGroup(sheet, group, slice);
          sheet.y += GAP;
        }
        continue;
      }
      if (block.kind === "text") {
        const headerHeight =
          (block.date ? META_SIZE + 6 : 0) + (block.title ? RECORD_SIZE + 10 : 0);
        if (sheet.elements.length && headerHeight + BODY_LEADING * 2 > sheet.room)
          turn();
        if (block.date) {
          sheet.elements.push(
            text(block.date, LEFT, sheet.y + META_SIZE, META_SIZE, { tone: "accent" }),
          );
          sheet.y += META_SIZE + 6;
        }
        if (block.title) {
          sheet.elements.push(
            text(block.title, LEFT, sheet.y + RECORD_SIZE, RECORD_SIZE, { serif: true }),
          );
          sheet.y += RECORD_SIZE + 10;
        }
        // 正文按行续页，绝不截断。
        for (const line of wrapAll(block.body, BODY_SIZE, CONTENT_W)) {
          if (BODY_LEADING > sheet.room) turn();
          sheet.elements.push(text(line, LEFT, sheet.y + BODY_SIZE, BODY_SIZE));
          sheet.y += BODY_LEADING;
        }
        // 落款靠右一行，跟着正文最后一行走。
        if (block.by) {
          if (BODY_LEADING > sheet.room) turn();
          sheet.elements.push(
            text(`—— ${block.by}`, RIGHT, sheet.y + BODY_SIZE, BODY_SIZE, {
              align: "right",
              tone: "muted",
            }),
          );
          sheet.y += BODY_LEADING;
        }
        sheet.y += GAP;
        continue;
      }
      // 清单：每条一行标题加一行日期，条目不跨页，数量不设上限。
      for (const entry of block.entries) {
        const height = RECORD_SIZE + META_SIZE + 14;
        if (height > sheet.room) turn();
        sheet.elements.push(
          text(entry.title, LEFT, sheet.y + RECORD_SIZE, RECORD_SIZE, { serif: true }),
        );
        sheet.elements.push(
          text(entry.date, LEFT, sheet.y + RECORD_SIZE + META_SIZE + 6, META_SIZE, {
            tone: "muted",
          }),
        );
        sheet.elements.push({ kind: "rule", y: sheet.y + height - 4 });
        sheet.y += height;
      }
      sheet.y += GAP;
    }
    if (sheet.elements.length) commit(sheet);
  }

  const end = new Sheet("colophon");
  end.y = BLEED_PT + TRIM_PT * 0.45;
  end.elements.push({ kind: "ornament", y: end.y });
  end.y += 16;
  for (const line of wrapAll(input.colophon, META_SIZE, CONTENT_W * 0.8)) {
    end.elements.push(
      text(line, middle, end.y, META_SIZE, { align: "center", tone: "muted" }),
    );
    end.y += META_SIZE + 6;
  }
  commit(end);

  return { sheet: SHEET_PT, trim: TRIM_PT, bleed: BLEED_PT, pages };
}

/** 安全框：给测试与渲染共用，文字必须整段落在里面。 */
export const SAFE_BOX = { left: LEFT, top: TOP, right: RIGHT, bottom: BOTTOM };

/** 导出前的清晰度预检：原图撑不满版位时印出来会发软，先说清楚。 */
export function softPhotoCount(
  layout: BookLayout,
  sizes: Record<string, { width: number; height: number } | undefined>,
  dpi = 150,
): number {
  let soft = 0;
  for (const page of layout.pages)
    for (const element of page.elements) {
      if (element.kind !== "photo") continue;
      const size = sizes[element.key];
      if (!size) continue;
      const needed = (Math.max(element.w, element.h) / 72) * dpi;
      if (Math.max(size.width, size.height) < needed) soft += 1;
    }
  return soft;
}

/** 这一页里某张照片的版位在 300 DPI 下有多少像素（取长边）。 */
export function slotPixels(page: BookPage, key: string): number {
  let longest = 0;
  for (const element of page.elements)
    if (element.kind === "photo" && element.key === key)
      longest = Math.max(longest, element.w, element.h);
  return Math.ceil(longest * SCALE);
}
