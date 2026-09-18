import { describe, expect, it } from "vitest";
import { A4_WIDTH_PT, buildPdf, pdfPageSlices } from "../src/local/pdf";

const jpeg = (fill: number, size = 32) =>
  Uint8Array.from({ length: size }, (_, i) => (i === 0 ? 0xff : fill));
const text = (pdf: Uint8Array) =>
  Array.from(pdf, (b) => String.fromCharCode(b)).join("");

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

  it("keeps the page box at A4 width and the image aspect", () => {
    const pdf = text(buildPdf([{ jpeg: jpeg(3), width: 750, height: 1500 }]));
    const height = (A4_WIDTH_PT * 1500) / 750;
    expect(pdf).toContain(
      `/MediaBox [0 0 ${A4_WIDTH_PT.toFixed(2)} ${height.toFixed(2)}]`,
    );
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
    const count = 3 + pages.length * 3;
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

  it("refuses an empty document", () => {
    expect(() => buildPdf([])).toThrow("没有可以导出的内容");
  });

  it("slices a long scroll into full pages and one remainder", () => {
    expect(pdfPageSlices(2500, 1000)).toEqual([
      { originY: 0, height: 1000 },
      { originY: 1000, height: 1000 },
      { originY: 2000, height: 500 },
    ]);
    expect(pdfPageSlices(1000, 1000)).toEqual([{ originY: 0, height: 1000 }]);
    expect(pdfPageSlices(0, 1000)).toEqual([]);
  });
});
