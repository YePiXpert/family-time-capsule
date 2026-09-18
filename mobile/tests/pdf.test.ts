import { describe, expect, it } from "vitest";
import { pdfTextString, writePdf } from "../src/local/pdf";

const jpeg = (fill: number, size = 32) =>
  Uint8Array.from({ length: size }, (_, i) => (i === 0 ? 0xff : fill));
const text = (pdf: Uint8Array) =>
  Array.from(pdf, (b) => String.fromCharCode(b)).join("");
/** 20×20cm 含出血的方页。 */
const BOX = { width: 583.94, height: 583.94 };
/** 测试里把流式输出接回一整份文件。 */
const buildPdf = (
  pages: { jpeg: Uint8Array; width: number; height: number }[],
  options: { box?: { width: number; height: number }; title?: string } = {},
) => {
  const chunks: Uint8Array[] = [];
  writePdf(
    pages.map((page) => ({
      width: page.width,
      height: page.height,
      read: () => page.jpeg,
    })),
    (bytes) => chunks.push(bytes),
    { ...options, box: options.box ?? BOX },
  );
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};

describe("pdf writer", () => {
  it("writes a readable single-page document around the original jpeg", () => {
    const bytes = jpeg(7);
    const pdf = buildPdf([{ jpeg: bytes, width: 750, height: 1061 }]);
    const body = text(pdf);
    expect(body.startsWith("%PDF-1.4")).toBe(true);
    expect(body.endsWith("%%EOF\n")).toBe(true);
    expect(body).toContain("/Type /Catalog");
    expect(body).toContain("/Count 1");
    expect(body).toContain("/Filter /DCTDecode");
    // 图片字节原样嵌进去，不做任何转码。
    expect(body).toContain(text(bytes));
    expect(body).toContain(`/Length ${bytes.length}`);
  });

  it("numbers every object and points the xref table at each one", () => {
    const pages = [
      { jpeg: jpeg(1), width: 750, height: 1061 },
      { jpeg: jpeg(2), width: 750, height: 1061 },
      { jpeg: jpeg(3), width: 750, height: 400 },
    ];
    const pdf = buildPdf(pages);
    const body = text(pdf);
    expect(body).toContain("/Count 3");
    expect(body).toContain("/Kids [3 0 R 6 0 R 9 0 R]");
    // 目录、页树、每页三个，外加末尾一个 /Info。
    const count = 3 + pages.length * 3 + 1;
    expect(body).toContain(`xref\n0 ${count}\n`);
    expect(body).toContain(`/Size ${count}`);
    const startxref = Number(/startxref\n(\d+)/.exec(body)![1]);
    expect(body.slice(startxref, startxref + 4)).toBe("xref");
    // 每条 xref 记录的偏移都要真的指向那个对象的开头。
    const rows = [...body.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(rows).toHaveLength(count - 1);
    rows.forEach((offset, index) => {
      expect(body.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj`));
    });
  });

  it("gives every page the same fixed box when the book asks for one", () => {
    const box = { width: 583.94, height: 583.94 };
    const body = text(
      buildPdf(
        [
          { jpeg: jpeg(1), width: 2433, height: 2433 },
          { jpeg: jpeg(2), width: 2433, height: 2433 },
        ],
        { box },
      ),
    );
    const boxes = [...body.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)];
    expect(boxes).toHaveLength(2);
    // 页与页之间不能差半毫米，否则印刷装订会看出来。
    for (const found of boxes) {
      expect(Number(found[1])).toBeCloseTo(box.width, 2);
      expect(Number(found[2])).toBeCloseTo(box.height, 2);
    }
  });

  it("writes a Chinese title as UTF-16BE so readers do not show mojibake", () => {
    const body = text(
      buildPdf([{ jpeg: jpeg(1), width: 100, height: 100 }], { title: "桉桉的 2026 年" }),
    );
    expect(body).toContain(pdfTextString("桉桉的 2026 年"));
    expect(pdfTextString("桉")).toBe("<FEFF6849>");
    expect(body).toMatch(/\/Info \d+ 0 R/);
  });

  it("refuses an empty document", () => {
    expect(() => buildPdf([])).toThrow("没有可以导出的内容");
  });

  it("reads a page's bytes only while that page is being written", () => {
    // 成册几十页，内存里一次只能过一页：读字节必须发生在写这一页的时候。
    const read: number[] = [];
    const seen: number[] = [];
    writePdf(
      [0, 1, 2].map((index) => ({
        width: 2433,
        height: 2433,
        read: () => {
          read.push(index);
          return jpeg(index + 1);
        },
      })),
      () => seen.push(read.length),
      { box: BOX },
    );
    expect(read).toEqual([0, 1, 2]);
    // 头部那几块写出去时，一页都还没读。
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(3);
  });
});
