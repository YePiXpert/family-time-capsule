import "server-only";

import { layoutPages, PAGE_STYLE, type Paragraph, type PageImage } from "./layout";

/**
 * 极简 PDF 生成器（M6）：页面 = sharp 渲染的 JPEG（SVG 排版中文），
 * 通过 DCTDecode 直嵌——不引用任何内部鉴权 URL，全部内容随文件携带。
 *
 * 故意不依赖 PDF 库：书籍只需要「页图序列」这一种能力，手写 PDF 封装
 * （catalog/pages/page/image xref）约百行，可控且无供应链面。
 */

export type PdfPageImage = PageImage & {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfLine = Paragraph & { x: number; y: number; width: number };

export type PdfPageInput = {
  paragraphs: PdfLine[];
  image: PdfPageImage | null;
};

function escapeXml(s: string): string {
  return s
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

/** 渲染单页 SVG → JPEG。字体由系统 fontconfig 提供（Docker 镜像内置 Noto CJK）。 */
async function renderPageJpeg(page: PdfPageInput): Promise<Buffer> {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${1240}" height="${1754}">`,
    `<rect width="100%" height="100%" fill="white"/>`,
  );
  if (page.image) {
    parts.push(
      `<image x="${page.image.x}" y="${page.image.y}" width="${page.image.width}" height="${page.image.height}" href="${page.image.dataUri}" preserveAspectRatio="xMidYMid meet"/>`,
    );
  }
  for (const line of page.paragraphs) {
    const style = PAGE_STYLE[line.kind];
    const anchor = line.kind === "title" || line.kind === "heading" ? "middle" : "start";
    const x = anchor === "middle" ? line.x + line.width / 2 : line.x;
    const fill = line.kind === "quote" ? "#333333" : "#111111";
    const fontStyle = line.kind === "quote" ? " font-style=\"italic\"" : "";
    parts.push(
      `<text x="${x}" y="${line.y + style.fontSize}" font-family="sans-serif" font-size="${style.fontSize}" fill="${fill}" text-anchor="${anchor}"${fontStyle}>${escapeXml(line.text)}</text>`,
    );
  }
  parts.push("</svg>");
  const sharp = (await import("sharp")).default;
  return sharp(Buffer.from(parts.join(""))).jpeg({ quality: 88 }).toBuffer();
}

/** 组装 PDF 字节流（页面顺序即书页顺序）。 */
export async function renderPdf(pages: PdfPageInput[]): Promise<Buffer> {
  const jpegs: Buffer[] = [];
  for (const page of pages) {
    jpegs.push(await renderPageJpeg(page));
  }

  const objects: string[] = []; // 每个 PDF 对象的 body（不含 "N 0 obj"/"endobj"）
  const pageObjectIds: number[] = [];
  const jpegIndexByObjectId = new Map<number, number>();
  // 1=catalog 2=pages 3..=每页(page+content+image)
  let nextId = 3;
  const pageCount = jpegs.length;

  for (let i = 0; i < pageCount; i++) {
    const pageId = nextId++;
    const contentId = nextId++;
    const imageId = nextId++;
    pageObjectIds.push(pageId);
    jpegIndexByObjectId.set(imageId, i);

    const w = 595; // PDF pt（A4）；位图 1240px 按比例映射
    const h = 842;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
      `/Resources << /XObject << /Im${i} ${imageId} 0 R >> >> ` +
      `/Contents ${contentId} 0 R >>`;
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
    objects[contentId] =
      `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
    objects[imageId] =
      `<< /Type /XObject /Subtype /Image /Width ${1240} /Height ${1754} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
      `/Length ${jpegs[i].length} >>\nstream\n`;
  }

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] =
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;

  // 组装字节流：文本对象 + 图像流（二进制）
  const chunks: Buffer[] = [];
  let offset = 0;
  const offsets: number[] = [];
  const push = (data: Buffer | string) => {
    const buf = typeof data === "string" ? Buffer.from(data, "latin1") : data;
    chunks.push(buf);
    offset += buf.length;
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  for (let id = 1; id < nextId; id++) {
    offsets[id] = offset;
    push(`${id} 0 obj\n`);
    const body = objects[id];
    if (body === undefined) continue;
    const imageIndex = jpegIndexByObjectId.get(id);
    push(body);
    if (imageIndex !== undefined) {
      push(jpegs[imageIndex]);
      push("\nendstream");
    }
    push("\nendobj\n");
  }

  const xrefStart = offset;
  let xref = `xref\n0 ${nextId}\n0000000000 65535 f \n`;
  for (let id = 1; id < nextId; id++) {
    xref += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  return Buffer.concat(chunks);
}

/** 便捷入口：段落流 → 分页 → PDF。 */
export async function renderParagraphsToPdf(
  paragraphs: Paragraph[],
  coverImage: PageImage | null = null,
): Promise<Buffer> {
  const pages = layoutPages(paragraphs, coverImage);
  return renderPdf(pages.map((p) => ({ paragraphs: p.paragraphs, image: p.image })));
}
