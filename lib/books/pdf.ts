import "server-only";
import { layoutPages, type Paragraph, type PageImage } from "./layout";
import { renderLegacyPdfIsolated } from "./render/jobs";
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
/** Original compatibility URLs now render text with the same bounded process lease. */
export async function renderPdf(pages: PdfPageInput[]): Promise<Buffer> {
  return renderLegacyPdfIsolated(pages);
}
export async function renderParagraphsToPdf(
  paragraphs: Paragraph[],
  coverImage: PageImage | null = null,
): Promise<Buffer> {
  return renderPdf(layoutPages(paragraphs, coverImage));
}
