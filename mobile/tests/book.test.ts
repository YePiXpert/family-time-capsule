import { describe, expect, it } from "vitest";
import {
  BLEED_PT,
  SAFE_BOX,
  SCALE,
  SHEET_PT,
  SHEET_PX,
  TRIM_PT,
  layoutBook,
  slotPixels,
  softPhotoCount,
  type BookBlock,
  type BookInput,
  type BookPage,
} from "../src/local/book";

const MM = 72 / 25.4;
const photos = (n: number, aspect = 4 / 3) =>
  Array.from({ length: n }, (_, i) => ({ key: `p${i}`, aspect }));

function input(overrides: Partial<BookInput> = {}): BookInput {
  return {
    title: "桉桉的 2026 年",
    subtitle: "120 段时光 · 300 张照片",
    stamp: "2026",
    titlePage: { name: "桉桉", birthday: "2025 年 9 月 10 日" },
    chapters: [],
    colophon: "桉桉的成长记 · 2026 年",
    ...overrides,
  };
}
const chapter = (blocks: BookBlock[], heading = "三月") => ({ heading, blocks });
const textsOf = (page: BookPage, size: number) =>
  page.elements.filter((e) => e.kind === "text" && e.size === size);

describe("成册版面", () => {
  it("开本是 200mm 见方，四周各 3mm 出血，300 DPI 一页 2433 像素", () => {
    expect(TRIM_PT).toBeCloseTo(200 * MM, 6);
    expect(BLEED_PT).toBeCloseTo(3 * MM, 6);
    expect(SHEET_PT).toBeCloseTo(206 * MM, 6);
    expect(SHEET_PX).toBe(2433);
  });

  it("封面与扉页不排页码，内容页从 1 起连号", () => {
    const layout = layoutBook(
      input({
        chapters: [
          chapter([{ kind: "text", body: "短短一段。" }]),
          chapter([{ kind: "text", body: "另一段。" }], "四月"),
        ],
      }),
    );
    expect(layout.pages[0]!.kind).toBe("cover");
    expect(layout.pages[1]!.kind).toBe("title");
    expect(layout.pages[0]!.folio).toBeNull();
    expect(layout.pages[1]!.folio).toBeNull();
    expect(layout.pages.at(-1)!.kind).toBe("colophon");
    expect(layout.pages.at(-1)!.folio).toBeNull();
    const numbered = layout.pages.filter((p) => p.folio !== null);
    expect(numbered.map((p) => p.folio)).toEqual(
      numbered.map((_, i) => i + 1),
    );
  });

  it("每个章节起新页，章节页带标题与引子", () => {
    const layout = layoutBook(
      input({
        chapters: [
          chapter([{ kind: "text", body: "一" }], "三月"),
          chapter([{ kind: "text", body: "二" }], "四月"),
        ],
      }),
    );
    const heads = layout.pages.filter((p) => p.kind === "chapter");
    expect(heads).toHaveLength(2);
    for (const head of heads)
      expect(head.elements.some((e) => e.kind === "text" && e.serif)).toBe(true);
  });

  it("长正文按页续排，一个字都不丢", () => {
    const body = "桉桉今天自己走了七步。".repeat(400);
    const layout = layoutBook(input({ chapters: [chapter([{ kind: "text", body }])] }));
    const lines = layout.pages
      .filter((p) => p.kind === "content")
      .flatMap((p) => textsOf(p, 10.5))
      .map((e) => (e.kind === "text" ? e.text : ""));
    expect(lines.join("")).toBe(body);
    expect(layout.pages.filter((p) => p.kind === "content").length).toBeGreaterThan(3);
  });

  it("「第一次」清单不再截断在第八条", () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      title: `第一次做第 ${i + 1} 件事`,
      date: "2026 年 3 月 1 日",
    }));
    const layout = layoutBook(input({ chapters: [chapter([{ kind: "list", entries }])] }));
    const titles = layout.pages
      .flatMap((p) => p.elements)
      .filter((e) => e.kind === "text" && e.text.startsWith("第一次做第"));
    expect(titles).toHaveLength(30);
  });

  it("照片每页最多四张，不跨页", () => {
    const layout = layoutBook(
      input({ chapters: [chapter([{ kind: "photos", photos: photos(9) }])] }),
    );
    for (const page of layout.pages)
      expect(page.elements.filter((e) => e.kind === "photo").length).toBeLessThanOrEqual(4);
    const placed = layout.pages.flatMap((p) =>
      p.elements.filter((e) => e.kind === "photo"),
    );
    expect(placed).toHaveLength(9);
  });

  it("文字与照片都待在安全框里，页码之外没有东西越界", () => {
    const layout = layoutBook(
      input({
        cover: { key: "cover", aspect: 1 },
        chapters: [
          chapter([
            { kind: "photos", photos: photos(4), captions: ["一", "二", "三", "四"] },
            { kind: "text", title: "学会走路", date: "3 月 1 日", body: "他自己走了七步。".repeat(80) },
            { kind: "list", entries: [{ title: "第一次走路", date: "3 月 1 日" }] },
          ]),
        ],
      }),
    );
    for (const page of layout.pages)
      for (const element of page.elements) {
        if (element.kind === "photo") {
          // 满版封面压到出血边是有意的，其余照片必须在安全框内。
          if (page.fullBleed) continue;
          expect(element.x).toBeGreaterThanOrEqual(SAFE_BOX.left - 0.01);
          expect(element.y).toBeGreaterThanOrEqual(SAFE_BOX.top - 0.01);
          expect(element.x + element.w).toBeLessThanOrEqual(SAFE_BOX.right + 0.01);
          expect(element.y + element.h).toBeLessThanOrEqual(SAFE_BOX.bottom + 0.01);
        }
        if (element.kind === "text" && element.size !== 8) {
          expect(element.y).toBeGreaterThanOrEqual(SAFE_BOX.top - 0.01);
          expect(element.y).toBeLessThanOrEqual(SAFE_BOX.bottom + 0.01);
        }
      }
  });

  it("页码排在安全框外的页脚，但离成品边至少 5mm", () => {
    const layout = layoutBook(
      input({ chapters: [chapter([{ kind: "text", body: "一句话。" }])] }),
    );
    const page = layout.pages.find((p) => p.folio !== null)!;
    const folio = page.elements.find((e) => e.kind === "text" && e.size === 8)!;
    expect(folio.kind === "text" && folio.text).toBe("1");
    const fromTrimEdge = BLEED_PT + TRIM_PT - (folio.kind === "text" ? folio.y : 0);
    expect(fromTrimEdge).toBeGreaterThanOrEqual(5 * MM);
  });

  it("同一页的照片互不重叠", () => {
    const layout = layoutBook(
      input({ chapters: [chapter([{ kind: "photos", photos: photos(4) }])] }),
    );
    for (const page of layout.pages) {
      const boxes = page.elements.filter((e) => e.kind === "photo");
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!, b = boxes[j]!;
          if (a.kind !== "photo" || b.kind !== "photo") continue;
          const apart =
            a.x + a.w <= b.x + 0.01 ||
            b.x + b.w <= a.x + 0.01 ||
            a.y + a.h <= b.y + 0.01 ||
            b.y + b.h <= a.y + 0.01;
          expect(apart).toBe(true);
        }
    }
  });

  it("有封面照就做满版，没有就用印章纸封面", () => {
    const withPhoto = layoutBook(input({ cover: { key: "c", aspect: 1 } }));
    expect(withPhoto.pages[0]!.fullBleed).toBe(true);
    const bled = withPhoto.pages[0]!.elements.find((e) => e.kind === "photo")!;
    expect(bled.kind === "photo" && bled.w).toBeCloseTo(SHEET_PT, 6);
    const paper = layoutBook(input());
    expect(paper.pages[0]!.fullBleed).toBe(false);
    expect(paper.pages[0]!.elements.some((e) => e.kind === "stamp")).toBe(true);
  });

  it("空册子也排得出封面、扉页与落款", () => {
    const layout = layoutBook(input({ chapters: [] }));
    expect(layout.pages.map((p) => p.kind)).toEqual(["cover", "title", "colophon"]);
  });

  it("版位像素按 300 DPI 算，取版位长边", () => {
    const layout = layoutBook(input({ cover: { key: "c", aspect: 1 } }));
    // 封面满版压到出血边，所以要的就是整张纸。
    expect(slotPixels(layout.pages[0]!, "c")).toBe(Math.ceil(SHEET_PT * SCALE));
    expect(slotPixels(layout.pages[0]!, "别的")).toBe(0);
  });

  it("清晰度预检只数撑不满版位的那几张", () => {
    const layout = layoutBook(
      input({ chapters: [chapter([{ kind: "photos", photos: photos(2) }])] }),
    );
    const slot = layout.pages
      .flatMap((page) => page.elements)
      .find((e) => e.kind === "photo")!;
    const needed = (Math.max(slot.w, slot.h) / 72) * 150;
    const big = { width: Math.ceil(needed) + 10, height: Math.ceil(needed) + 10 };
    const small = { width: Math.floor(needed) - 10, height: Math.floor(needed) - 10 };
    expect(softPhotoCount(layout, { p0: big, p1: small })).toBe(1);
    expect(softPhotoCount(layout, { p0: small, p1: small })).toBe(2);
    // 不知道尺寸的照片不算软：宁可不提醒，也不凭空吓人。
    expect(softPhotoCount(layout, { p0: big })).toBe(0);
  });
});
