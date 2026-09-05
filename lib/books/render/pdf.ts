import PDFDocument from "pdfkit";
import { checkedPdfText } from "./text";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import type { BookBlock } from "@/mobile/src/books/types";
import {
  BOOK_RENDER_LIMITS,
  type RenderInput,
  type RenderProgress,
} from "./types";
import { renderBookImage } from "./images";
/** Selectable Unicode text; no user HTML, network requests, or page rasterization. */
export async function renderBookPdf(
  input: RenderInput,
  outputPath: string,
  progress: RenderProgress,
): Promise<number> {
  const book = input.book,
    margin = book.pageSize === "A4" ? 48 : 36;
  const pdf = new PDFDocument({
    font: input.fontPath,
    size: book.pageSize,
    margins: { top: margin, bottom: margin + 14, left: margin, right: margin },
    bufferPages: true,
    autoFirstPage: false,
    info: {
      Title: book.title,
      Subject: book.audience === "family" ? "家庭可读版" : "私人阅读版",
      Creator: "Family Time Capsule",
      Author: "家庭成员",
    },
  });
  const output = createWriteStream(outputPath, { flags: "wx" }),
    complete = finished(output);
  pdf.pipe(output);
  pdf.on("error", (e) => output.destroy(e));
  let pages = 0;
  pdf.on("pageAdded", () => {
    pages++;
    if (pages > BOOK_RENDER_LIMITS.pages)
      throw new Error("page_limit_exceeded");
    progress(
      Math.min(90, 5 + Math.floor((pages / BOOK_RENDER_LIMITS.pages) * 80)),
      pages,
    );
  });
  pdf.font(input.fontPath);
  const normalized = checkedPdfText(pdf);
  const width = () => pdf.page.width - margin * 2,
    bottom = () => pdf.page.height - margin - 14;
  function text(
    value: string,
    size = 11,
    options: PDFKit.Mixins.TextOptions = {},
  ) {
    if (!value.trim()) return;
    pdf
      .fillColor("#302924")
      .fontSize(size)
      .text(normalized(value), margin, pdf.y, {
        width: width(),
        lineGap: 4,
        ...options,
      });
  }
  function room(height: number) {
    if (pdf.y + height > bottom()) pdf.addPage();
  }
  function gap(n = 8) {
    pdf.y += n;
  }
  const sourceText = (block: BookBlock) =>
    [
      ...new Set(
        block.sourceIds
          .map((id) => book.sourceStates[id]?.label)
          .filter(Boolean),
      ),
    ].join("、");
  const dateText = (block: BookBlock) =>
    [
      ...new Set(
        block.sourceIds.flatMap((id) => {
          const state = book.sourceStates[id];
          return state?.occurredAt
            ? [
                `${new Intl.DateTimeFormat("zh-CN", { timeZone: book.timezone, dateStyle: "long" }).format(new Date(state.occurredAt))}${state.ageLabel ? " · " + state.ageLabel : ""}`,
              ]
            : [];
        }),
      ),
    ].join(" / ");
  try {
    pdf.addPage();
    gap(32);
    text(book.audience === "family" ? "家庭可读版" : "私人阅读版", 10);
    gap(18);
    text(book.title, book.pageSize === "A4" ? 30 : 24);
    gap(8);
    text(book.subtitle, 14);
    gap(8);
    text([book.startDate, book.endDate].filter(Boolean).join(" — "), 10);
    if (book.coverAssetId) {
      room(210);
      const image = await renderBookImage(
        input,
        book.coverAssetId,
        (width() * 300) / 72,
        (210 * 300) / 72,
      );
      pdf.image(image, margin, pdf.y, {
        fit: [width(), 210],
        align: "center",
        valign: "center",
      });
      pdf.y += 220;
    }
    gap();
    text(
      "照片按现有分辨率排版，低清素材无法补出细节。音视频请在作品或精选阅读包中播放。",
      9,
    );
    gap();
    text("本版不是完整可恢复备份。", 9);
    const toc: { page: number; y: number; chapterId: string; title: string }[] =
      [];
    if (book.chapters.length) {
      pdf.addPage();
      text("目录", 22);
      gap(14);
      for (const chapter of book.chapters) {
        pdf.fontSize(11);
        const h =
          pdf.heightOfString(normalized(chapter.title), {
            width: width() - 40,
            lineGap: 3,
          }) + 12;
        if (pdf.y + h > bottom()) {
          pdf.addPage();
          text("目录（续）", 18);
          gap(12);
        }
        toc.push({
          page: pages - 1,
          y: pdf.y,
          chapterId: chapter.id,
          title: chapter.title,
        });
        pdf.y += h;
      }
    }
    const chapterPages = new Map<string, number>();
    for (const [chapterIndex, chapter] of book.chapters.entries()) {
      pdf.addPage();
      chapterPages.set(chapter.id, pages);
      pdf.addNamedDestination(`chapter-${chapter.id}`);
      text(chapter.title, book.template === "letters" ? 23 : 21);
      gap(14);
      const blocks = book.blocks.filter((b) => b.chapterId === chapter.id);
      if (!blocks.length) text("本章尚未选入内容。", 11);
      for (const [index, block] of blocks.entries()) {
        if (block.layout.breakBefore && index > 0) pdf.addPage();
        if (block.kind === "date") {
          room(50);
          text(dateText(block), 10);
          gap(6);
        }
        const images = block.sourceIds
          .flatMap((id) => {
            const asset = book.sourceStates[id]?.asset;
            return asset?.type === "image" ? [asset] : [];
          })
          .slice(
            0,
            block.kind === "double" ? 2 : block.kind === "collage" ? 4 : 1,
          );
        if (
          ["image", "double", "collage"].includes(block.kind) &&
          images.length
        ) {
          const columns = images.length > 1 ? 2 : 1,
            gutter = 10,
            boxW = (width() - gutter * (columns - 1)) / columns,
            boxH =
              columns === 1 ? (book.template === "photos" ? 300 : 220) : 145;
          for (let i = 0; i < images.length; i += columns) {
            room(boxH + 10);
            const y = pdf.y;
            for (let j = 0; j < columns && i + j < images.length; j++) {
              const image = await renderBookImage(
                input,
                images[i + j]!.id,
                (boxW * 300) / 72,
                (boxH * 300) / 72,
                block,
                i + j,
              );
              pdf.image(image, margin + j * (boxW + gutter), y, {
                fit: [boxW, boxH],
                align: "center",
                valign: "center",
              });
            }
            pdf.y = y + boxH + 10;
          }
        }
        if (block.kind === "quote") {
          room(60);
          text(block.text, book.template === "letters" ? 13 : 12);
          const author = block.sourceIds
            .map((id) => book.sourceStates[id]?.author)
            .find(Boolean);
          if (author) {
            gap(6);
            text(`—— ${author}`, 10, { align: "right" });
          }
          const authored = block.sourceIds.map(id => book.sourceStates[id]?.authoredAt).find(Boolean);
          if (authored) text(`讲述于 ${new Intl.DateTimeFormat("zh-CN", {timeZone: book.timezone, dateStyle: "long"}).format(new Date(authored))}`, 9, {align: "right"});
          text(dateText(block), 9, { align: "right" });
        } else text(block.text, book.template === "photos" ? 10 : 11);
        if (block.caption) {
          gap(6);
          text(block.caption, 9);
        }
        const source = sourceText(block);
        if (source) {
          gap(5);
          text(`来源：${source}`, 8);
        }
        gap(14);
      }
      progress(
        Math.min(
          90,
          10 + Math.floor(((chapterIndex + 1) / book.chapters.length) * 80),
        ),
        pages,
      );
    }
    const finalPages = pages;
    for (const entry of toc) {
      pdf.switchToPage(entry.page);
      pdf
        .fontSize(11)
        .fillColor("#302924")
        .text(normalized(entry.title), margin, entry.y, {
          width: width() - 40,
          lineGap: 3,
        });
      pdf.text(
        String(chapterPages.get(entry.chapterId)),
        pdf.page.width - margin - 30,
        entry.y,
        { width: 30, align: "right", lineBreak: false },
      );
      pdf.goTo(margin, entry.y, width(), 16, `chapter-${entry.chapterId}`);
    }
    for (let i = 0; i < finalPages; i++) {
      pdf.switchToPage(i);
      const priorBottom = pdf.page.margins.bottom;
      pdf.page.margins.bottom = 0;
      pdf
        .fontSize(8)
        .fillColor("#77685e")
        .text(`${i + 1} / ${finalPages}`, margin, pdf.page.height - 24, {
          width: width(),
          align: "center",
          lineBreak: false,
        });
      pdf.page.margins.bottom = priorBottom;
    }
    if (pages !== finalPages) throw new Error("unexpected_pagination");
    pdf.end();
    await complete;
    progress(95, finalPages);
    return finalPages;
  } catch (e) {
    pdf.destroy();
    output.destroy();
    await complete.catch(() => {});
    throw e;
  }
}
