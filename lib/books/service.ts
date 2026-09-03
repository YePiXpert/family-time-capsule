import { randomUUID, createHash } from "node:crypto";
import { isNull, and, eq, gte, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { memoryEvent } from "@/db/schema/memory";
import { getAsset } from "@/lib/assets/service";
import { getAssetStorage } from "@/lib/assets/storage";
import { getStory } from "@/lib/stories/service";
import { renderParagraphsToPdf } from "./pdf";
import { renderEpub, type EpubBook, type EpubChapter } from "./epub";
import type { PageImage, Paragraph } from "./layout";

/**
 * 书籍服务（M6）：从已发布故事或某一年的事件生成 PDF/EPUB。
 *
 * - 图像使用专用 JPEG derivative（缩略图或原图经 sharp 转 JPEG）内嵌——
 *   绝不引用 /api/media 等内部鉴权 URL；
 * - 只读已发布/确认内容；导出的书是即时生成的产物，不属于 archive 格式。
 */

export type BookFormat = "pdf" | "epub";

export type BookResult =
  | { ok: true; buffer: Buffer; filename: string; contentType: string }
  | { ok: false; error: string };

async function assetToPageImage(
  familyId: string,
  assetId: string,
): Promise<PageImage | null> {
  const asset = await getAsset(familyId, assetId);
  if (!asset) return null;
  const db = getDb();
  const { asset: assetTable } = await import("@/db/schema/asset");
  const { desc } = await import("drizzle-orm");
  // 优先缩略图（小、快），否则原图
  const thumb = db
    .select()
    .from(assetTable)
    .where(
      and(
        eq(assetTable.familyId, familyId),
        eq(assetTable.originalAssetId, assetId),
        eq(assetTable.derivativeType, "thumbnail"),
      ),
    )
    .orderBy(desc(assetTable.createdAt))
    .limit(1)
    .get();
  const sourceKey = thumb?.storageKey ?? asset.storageKey;

  try {
    const storage = getAssetStorage();
    const buffer = storage.read(sourceKey);
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp(buffer)
      .rotate()
      .resize({ width: 1000, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    const meta = await sharp(jpeg).metadata();
    const width = meta.width ?? 1000;
    const height = meta.height ?? 1000;
    return {
      dataUri: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
      aspectRatio: width / height,
    };
  } catch {
    return null; // 单图失败不阻断整本书
  }
}

// ---- 故事书 ----

export async function generateStoryBook(
  familyId: string,
  storyId: string,
  format: BookFormat,
  familyName: string,
): Promise<BookResult> {
  const detail = await getStory(familyId, storyId);
  if (!detail) return { ok: false, error: "story_not_found" };
  if (detail.story.status !== "published") {
    return { ok: false, error: "story_not_published" };
  }

  const title = detail.story.title;
  if (format === "pdf") {
    const paragraphs: Paragraph[] = [
      { kind: "title", text: title },
      ...detail.paragraphs.map((p) =>
        p.kind === "quote"
          ? ({ kind: "quote", text: `「${p.text}」` } as Paragraph)
          : ({ kind: "body", text: p.text } as Paragraph),
      ),
    ];
    const buffer = await renderParagraphsToPdf(paragraphs);
    return {
      ok: true,
      buffer,
      filename: `${sanitizeFilename(title)}.pdf`,
      contentType: "application/pdf",
    };
  }

  const chapters: EpubChapter[] = [
    {
      title,
      paragraphs: detail.paragraphs.map((p) =>
        p.kind === "quote"
          ? { kind: "quote" as const, text: p.text }
          : { kind: "body" as const, text: p.text },
      ),
      image: null,
    },
  ];
  const book: EpubBook = {
    title,
    author: familyName,
    language: "zh-CN",
    chapters,
  };
  const buffer = await renderEpub(book, randomUUID());
  return {
    ok: true,
    buffer,
    filename: `${sanitizeFilename(title)}.epub`,
    contentType: "application/epub+zip",
  };
}

// ---- 年度书 ----

export async function generateYearBook(
  familyId: string,
  year: number,
  format: BookFormat,
  familyName: string,
): Promise<BookResult> {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const events = getDb()
    .select()
    .from(memoryEvent)
    .where(
      and(
        eq(memoryEvent.familyId, familyId),
        isNull(memoryEvent.deletedAt),
        gte(memoryEvent.occurredAt, start),
        lt(memoryEvent.occurredAt, end),
      ),
    )
    .orderBy(memoryEvent.occurredAt)
    .all();
  if (events.length === 0) {
    return { ok: false, error: "no_events" };
  }

  const title = `${familyName} · ${year}`;
  const filenameBase = `${sanitizeFilename(title)}`;

  if (format === "pdf") {
    const paragraphs: Paragraph[] = [
      { kind: "title", text: title },
      { kind: "body", text: `${events.length} 个瞬间，留在这一年。` },
    ];
    // 逐事件成章：标题 + （封面图）+ 占位正文（日期）
    const pageInputs: Array<{
      paragraphs: import("./pdf").PdfLine[];
      image: import("./pdf").PdfPageImage | null;
    }> = [];
    const { layoutPages } = await import("./layout");
    const coverAssetId = events[0].coverAssetId ?? null;
    const cover = coverAssetId ? await assetToPageImage(familyId, coverAssetId) : null;
    const titlePages = layoutPages(paragraphs, cover);
    for (const p of titlePages) {
      pageInputs.push({ paragraphs: p.paragraphs, image: p.image });
    }
    for (const event of events) {
      const image = event.coverAssetId
        ? await assetToPageImage(familyId, event.coverAssetId)
        : null;
      const eventParas: Paragraph[] = [
        { kind: "heading", text: event.title },
        {
          kind: "body",
          text: new Intl.DateTimeFormat("zh-CN", { dateStyle: "long", timeZone: "UTC" })
            .format(event.occurredAt),
        },
      ];
      if (event.locationText) {
        eventParas.push({ kind: "body", text: event.locationText });
      }
      const pages = layoutPages(eventParas, image);
      for (const p of pages) {
        pageInputs.push({ paragraphs: p.paragraphs, image: p.image });
      }
    }
    const { renderPdf } = await import("./pdf");
    const buffer = await renderPdf(pageInputs);
    return {
      ok: true,
      buffer,
      filename: `${filenameBase}.pdf`,
      contentType: "application/pdf",
    };
  }

  // EPUB：每事件一章（含封面图）
  const chapters: EpubChapter[] = [];
  for (const event of events) {
    const image = event.coverAssetId
      ? await assetToPageImage(familyId, event.coverAssetId)
      : null;
    const paras: Paragraph[] = [
      {
        kind: "body",
        text: new Intl.DateTimeFormat("zh-CN", { dateStyle: "long", timeZone: "UTC" })
          .format(event.occurredAt),
      },
    ];
    if (event.locationText) {
      paras.push({ kind: "body", text: event.locationText });
    }
    chapters.push({ title: event.title, paragraphs: paras, image });
  }
  const book: EpubBook = { title, author: familyName, language: "zh-CN", chapters };
  const buffer = await renderEpub(book, randomUUID());
  return {
    ok: true,
    buffer,
    filename: `${filenameBase}.epub`,
    contentType: "application/epub+zip",
  };
}

function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|\s]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 60) || "book"
  );
}

/** 生成内容完整性指纹（测试用：确认无内部 URL）。 */
export function bookIntegrityHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
