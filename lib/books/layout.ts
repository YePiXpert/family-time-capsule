import "server-only";

/**
 * 书籍排版（M6）：CJK/拉丁混排的换行与分页（纯逻辑，供 PDF/EPUB 共用）。
 *
 * PDF 页面经 SVG 渲染：文本由本模块折行；图像在页内按宽度适配、限高。
 */

export type Paragraph = {
  kind: "title" | "heading" | "body" | "quote";
  text: string;
};

export type PageImage = {
  /** 已编码好的 data URI（image/jpeg;base64,...） */
  dataUri: string;
  aspectRatio: number; // width / height
};

export type LaidOutPage = {
  paragraphs: Array<Paragraph & { x: number; y: number; width: number }>;
  image: (PageImage & { x: number; y: number; width: number; height: number }) | null;
};

export const PAGE_WIDTH = 1240;
export const PAGE_HEIGHT = 1754; // A4 @ ~150dpi
const MARGIN = 110;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const STYLE = {
  title: { fontSize: 72, lineHeight: 96, marginTop: 480 },
  heading: { fontSize: 46, lineHeight: 66, marginTop: 72 },
  body: { fontSize: 34, lineHeight: 60, marginTop: 24 },
  quote: { fontSize: 34, lineHeight: 60, marginTop: 32 },
} as const;

/** CJK 逐字折行；拉丁词保持完整。fontSize 近似按 1em 宽（CJK）估算。 */
export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
): string[] {
  const lines: string[] = [];
  const isCjk = (ch: string) =>
    /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]/u.test(ch);
  let current = "";
  let currentWidth = 0;

  const pushLine = () => {
    if (current.length > 0) lines.push(current);
    current = "";
    currentWidth = 0;
  };

  const segments = text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]|\s+|[^\s\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]+/gu) ?? [];
  for (const segment of segments) {
    if (/^\s+$/u.test(segment)) {
      // 拉丁空格：行首丢弃
      if (current.length > 0 && !isCjk(current[current.length - 1])) {
        current += " ";
        currentWidth += fontSize * 0.3;
      }
      continue;
    }
    const segWidth = isCjk(segment[0])
      ? segment.length * fontSize
      : segment.length * fontSize * 0.55;
    if (currentWidth + segWidth <= maxWidth) {
      current += segment;
      currentWidth += segWidth;
      continue;
    }
    if (isCjk(segment[0])) {
      pushLine();
      current = segment;
      currentWidth = segWidth;
    } else {
      // 拉丁词放不下：换行放
      pushLine();
      current = segment;
      currentWidth = segWidth;
    }
  }
  pushLine();
  return lines;
}

/** 把段落流排版为页序列（可选页首图）。 */
export function layoutPages(
  paragraphs: Paragraph[],
  firstPageImage: PageImage | null = null,
): LaidOutPage[] {
  const pages: LaidOutPage[] = [];
  let page: LaidOutPage = { paragraphs: [], image: null };
  let y = MARGIN;

  const startPage = () => {
    page = { paragraphs: [], image: null };
    y = MARGIN;
  };
  const flushPage = () => {
    if (page.paragraphs.length > 0 || page.image) pages.push(page);
  };

  if (firstPageImage) {
    const maxImageHeight = PAGE_HEIGHT * 0.42;
    let width = CONTENT_WIDTH;
    let height = width / firstPageImage.aspectRatio;
    if (height > maxImageHeight) {
      height = maxImageHeight;
      width = height * firstPageImage.aspectRatio;
    }
    page.image = {
      ...firstPageImage,
      x: MARGIN + (CONTENT_WIDTH - width) / 2,
      y,
      width,
      height,
    };
    y += height + 60;
  }

  for (const paragraph of paragraphs) {
    const style = STYLE[paragraph.kind];
    y += style.marginTop;
    const lines = wrapText(paragraph.text, CONTENT_WIDTH, style.fontSize);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      if (y + style.lineHeight > PAGE_HEIGHT - MARGIN) {
        flushPage();
        startPage();
        y = MARGIN + style.marginTop;
      }
      page.paragraphs.push({
        ...paragraph,
        x: MARGIN,
        y,
        width: CONTENT_WIDTH,
      });
      // y 只用于顺序；渲染时用行内位置
      y += style.lineHeight;
    }
    // 单段不可跨页时（超长），已按行分页处理
  }
  flushPage();
  if (pages.length === 0) {
    pages.push({ paragraphs: [], image: null });
  }
  return pages;
}

export const PAGE_STYLE = STYLE;
