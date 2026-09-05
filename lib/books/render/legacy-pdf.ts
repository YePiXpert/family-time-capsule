import PDFDocument from "pdfkit";
import { checkedPdfText } from "./text";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import type { PdfPageInput } from "../pdf";
import { BOOK_RENDER_LIMITS } from "./types";
/** Compatibility downloads keep their URLs and binary response with searchable text. */
export async function renderLegacyPages(
  pages: PdfPageInput[],
  fontPath: string,
  outputPath: string,
) {
  if (
    !Array.isArray(pages) ||
    pages.length > 200 ||
    pages.reduce(
      (n, p) => n + p.paragraphs.reduce((m, t) => m + t.text.length, 0),
      0,
    ) > 500000
  )
    throw new Error("page_limit_exceeded");
  const pdf = new PDFDocument({
      font: fontPath,
      size: "A4",
      margin: 48,
      bufferPages: true,
      autoFirstPage: false,
    }),
    out = createWriteStream(outputPath, { flags: "wx" }),
    done = finished(out);
  pdf.pipe(out);
  pdf.on("error", (e) => out.destroy(e));
  let count = 0;
  pdf.on("pageAdded", () => {
    if (++count > BOOK_RENDER_LIMITS.pages)
      throw new Error("page_limit_exceeded");
  });
  pdf.font(fontPath);
  const normalized = checkedPdfText(pdf);
  try {
    for (const page of pages) {
      pdf.addPage();
      if (page.image) {
        if (
          !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(page.image.dataUri)
        )
          throw new Error("invalid_image");
        const image = Buffer.from(page.image.dataUri.split(",")[1]!, "base64");
        if (image.length > 16 * 1024 * 1024)
          throw new Error("image_output_too_large");
        pdf.image(image, 48, pdf.y, {
          fit: [499, 250],
          align: "center",
          valign: "center",
        });
        pdf.y += 265;
      }
      for (const p of page.paragraphs) {
        const size = p.kind === "title" ? 26 : p.kind === "heading" ? 20 : 12;
        pdf
          .fontSize(size)
          .fillColor("#302924")
          .text(normalized(p.text), 48, pdf.y, {
            width: 499,
            lineGap: 4,
            align: p.kind === "title" ? "center" : "left",
          });
        pdf.moveDown(0.3);
      }
    }
    const final = count;
    for (let i = 0; i < final; i++) {
      pdf.switchToPage(i);
      pdf.page.margins.bottom = 0;
      pdf.fontSize(8).text(`${i + 1} / ${final}`, 48, pdf.page.height - 24, {
        width: 499,
        align: "center",
        lineBreak: false,
      });
    }
    if (count !== final) throw new Error("unexpected_pagination");
    pdf.end();
    await done;
    return final;
  } catch (e) {
    pdf.destroy();
    out.destroy();
    await done.catch(() => {});
    throw e;
  }
}
