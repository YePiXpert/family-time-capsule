/**
 * 最小 PDF 写入器：每页一张 JPEG，按页铺满。只做这一件事，不引第三方库。
 * 页面尺寸按 A4 宽 595.28pt，高度随图片比例，长图裁成的每一页都印得满。
 */
export const A4_WIDTH_PT = 595.28;

export type PdfPage = { jpeg: Uint8Array; width: number; height: number };

const latin1 = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
};

/** 两位小数就够：PDF 的坐标单位是点，再精细也印不出来。 */
const pt = (value: number) => value.toFixed(2);

export function buildPdf(pages: PdfPage[]): Uint8Array {
  if (!pages.length) throw new Error("没有可以导出的内容。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  const push = (part: Uint8Array | string) => {
    const bytes = typeof part === "string" ? latin1(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  // 对象编号：1 目录、2 页树，之后每页三个（页、内容流、图片）。
  const offsets: number[] = [];
  const object = (id: number, body: () => void) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    body();
    push("endobj\n");
  };
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  object(1, () => push("<< /Type /Catalog /Pages 2 0 R >>\n"));
  object(2, () =>
    push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\n`),
  );
  pages.forEach((page, i) => {
    const pageId = 3 + i * 3,
      contentId = pageId + 1,
      imageId = pageId + 2;
    const width = A4_WIDTH_PT;
    const height = (A4_WIDTH_PT * page.height) / page.width;
    object(pageId, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt(width)} ${pt(height)}] ` +
          `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\n`,
      ),
    );
    const content = `q ${pt(width)} 0 0 ${pt(height)} 0 0 cm /Im0 Do Q\n`;
    object(contentId, () => {
      push(`<< /Length ${content.length} >>\nstream\n`);
      push(content);
      push("endstream\n");
    });
    object(imageId, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      );
      push(page.jpeg);
      push("\nendstream\n");
    });
  });
  const count = 3 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++)
    push(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
  push(
    `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** 长图按页高切成几页，最后一页取剩下的高度。 */
export function pdfPageSlices(
  totalHeight: number,
  pageHeight: number,
): { originY: number; height: number }[] {
  if (totalHeight < 1 || pageHeight < 1) return [];
  const slices: { originY: number; height: number }[] = [];
  for (let y = 0; y < totalHeight; y += pageHeight)
    slices.push({ originY: y, height: Math.min(pageHeight, totalHeight - y) });
  return slices;
}
