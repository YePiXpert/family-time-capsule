/**
 * 最小 PDF 写入器：每页一张 JPEG，按页铺满。只做这一件事，不引第三方库。
 * 页面尺寸由调用方定死，页与页之间不会差半毫米——送印厂按 MediaBox 裁切。
 */
import { APP_NAME } from "./brand";

export type PdfOptions = {
  /** 页面尺寸，单位 pt；每一页都用它。 */
  box: { width: number; height: number };
  title?: string;
};

/** PDF 的文本串：中文只能走带 BOM 的 UTF-16BE 十六进制串，latin1 会写成乱码。 */
export function pdfTextString(value: string): string {
  let out = "FEFF";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (code > 0xffff) {
      const rest = code - 0x10000;
      out += (0xd800 + (rest >> 10)).toString(16).padStart(4, "0");
      out += (0xdc00 + (rest & 0x3ff)).toString(16).padStart(4, "0");
    } else out += code.toString(16).padStart(4, "0");
  }
  return `<${out.toUpperCase()}>`;
}

const latin1 = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
};

/** 两位小数就够：PDF 的坐标单位是点，再精细也印不出来。 */
const pt = (value: number) => value.toFixed(2);

/** 一页的来源：字节按需读，成册几十页时内存里一次只过一页。 */
export type PdfPageSource = {
  width: number;
  height: number;
  read: () => Uint8Array;
};

/** 逐块写出 PDF。sink 可以直接是文件句柄，整份文件不必先堆进内存。 */
export function writePdf(
  pages: PdfPageSource[],
  sink: (bytes: Uint8Array) => void,
  options: PdfOptions,
): void {
  if (!pages.length) throw new Error("没有可以导出的内容。");
  let length = 0;
  const push = (part: Uint8Array | string) => {
    const bytes = typeof part === "string" ? latin1(part) : part;
    sink(bytes);
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
    const { width, height } = options.box;
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
      const jpeg = page.read();
      push(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      );
      push(jpeg);
      push("\nendstream\n");
    });
  });
  const infoId = 3 + pages.length * 3;
  object(infoId, () =>
    push(
      `<< /Title ${pdfTextString(options.title ?? "成长纪念册")} ` +
        `/Creator ${pdfTextString(APP_NAME)} >>\n`,
    ),
  );
  const count = infoId + 1;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++)
    push(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
  push(
    `trailer\n<< /Size ${count} /Root 1 0 R /Info ${infoId} 0 R >>\n` +
      `startxref\n${xref}\n%%EOF\n`,
  );
}
