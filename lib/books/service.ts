import "server-only";

import type { FamilyContext } from "@/lib/family/context";
import { assertBookContext, BookError } from "./projects/service";
import {
  createBookSourceResolver,
  sourceFingerprint,
} from "./projects/sources";
import { randomUUID, createHash } from "node:crypto";
import { isNull, and, eq, gte, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { family } from "@/db/schema/family";
import { calendarRange } from "@/lib/memories/calendar-range";
import { memoryEvent } from "@/db/schema/memory";
import { getAsset } from "@/lib/assets/service";
import { getAssetStorage } from "@/lib/assets/storage";
import { getStory } from "@/lib/stories/service";
import { renderParagraphsToPdf } from "./pdf";
import {
  renderLegacyEpubIsolated,
  assertCompatibilityRenderBudget,
} from "./render/jobs";
import { type EpubBook, type EpubChapter } from "./epub";
import type { PageImage, Paragraph } from "./layout";

/**
 * 书籍服务（M6）：从已发布故事或某一年的事件生成 PDF/EPUB。
 *
 * - 图像从原件经有界 sharp 转换为版面 JPEG 内嵌——
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
  assertCompatibilityRenderBudget();
  const asset = await getAsset(familyId, assetId);
  if (!asset || asset.type !== "image") return null;

  try {
    const storage = getAssetStorage();

    const sharp = (await import("sharp")).default;
    const jpeg = await sharp(storage.resolvePath(asset.storageKey), {
      limitInputPixels: 64_000_000,
    })
      .timeout({ seconds: 30 })
      .rotate()
      .resize({ width: 2400, withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    assertCompatibilityRenderBudget();
    const meta = await sharp(jpeg).metadata();
    const width = meta.width ?? 1000;
    const height = meta.height ?? 1000;
    return {
      dataUri: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
      aspectRatio: width / height,
    };
  } catch (e) {
    if (e instanceof BookError) throw e;
    return null; // 单图失败不阻断整本书
  }
}

// ---- 故事书 ----

export async function generateStoryBook(
  familyId: string,
  storyId: string,
  format: BookFormat,
  familyName: string,
  context?: FamilyContext,
): Promise<BookResult> {
  const detail = await getStory(familyId, storyId);
  if (!detail) return { ok: false, error: "story_not_found" };
  if (detail.story.status !== "published") {
    return { ok: false, error: "story_not_published" };
  }

  const verify = () => {
    if (!context) return "";
    assertBookContext(context);
    const resolved = createBookSourceResolver(context, "family")(
      "story",
      storyId,
    );
    if (!resolved.state.available)
      throw new BookError("source_unavailable", 409);
    return resolved.fingerprint;
  };
  const digest = verify();
  const recheck = () => {
    if (verify() !== digest) throw new BookError("source_changed", 409);
  };
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
    recheck();
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
  const buffer = await renderLegacyEpubIsolated(book, randomUUID());
  recheck();
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
  context?: FamilyContext,
): Promise<BookResult> {
  const familyRow = getDb()
    .select()
    .from(family)
    .where(eq(family.id, familyId))
    .get();
  if (!familyRow) return { ok: false, error: "family_not_found" };
  const { from: start, before: end } = calendarRange(
    String(year),
    familyRow.timezone,
  );
  if (context) assertBookContext(context);
  const resolver = context ? createBookSourceResolver(context, "family") : null;
  const events = getDb()
    .select()
    .from(memoryEvent)
    .where(
      and(
        eq(memoryEvent.familyId, familyId),
        eq(memoryEvent.status, "confirmed"),
        isNull(memoryEvent.deletedAt),
        gte(memoryEvent.occurredAt, start),
        lt(memoryEvent.occurredAt, end),
      ),
    )
    .orderBy(memoryEvent.occurredAt)
    .all()
    .filter((e) => !resolver || resolver("memory", e.id).state.available);
  if (events.length === 0) {
    return { ok: false, error: "no_events" };
  }

  const verify = () => {
    if (!context) return "";
    assertBookContext(context);
    const resolve = createBookSourceResolver(context, "family");
    return sourceFingerprint(
      events.map((e) => {
        const memory = resolve("memory", e.id);
        if (!memory.state.available)
          throw new BookError("source_unavailable", 409);
        const image = e.coverAssetId ? resolve("asset", e.coverAssetId) : null;
        return [
          e.id,
          memory.fingerprint,
          image?.state.available,
          image?.fingerprint,
        ];
      }),
    );
  };
  const digest = verify(),
    recheck = () => {
      if (verify() !== digest) throw new BookError("source_changed", 409);
    };
  const allowedCover = (assetId: string | null) =>
    assetId && (!resolver || resolver("asset", assetId).state.available)
      ? assetId
      : null;
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
    const coverAssetId = allowedCover(events[0].coverAssetId);
    const cover = coverAssetId
      ? await assetToPageImage(familyId, coverAssetId)
      : null;
    const titlePages = layoutPages(paragraphs, cover);
    for (const p of titlePages) {
      pageInputs.push({ paragraphs: p.paragraphs, image: p.image });
    }
    for (const event of events) {
      const image = allowedCover(event.coverAssetId)
        ? await assetToPageImage(familyId, event.coverAssetId!)
        : null;
      const eventParas: Paragraph[] = [
        { kind: "heading", text: event.title },
        {
          kind: "body",
          text: new Intl.DateTimeFormat("zh-CN", {
            dateStyle: "long",
            timeZone: familyRow.timezone,
          }).format(event.occurredAt),
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
    recheck();
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
    const image = allowedCover(event.coverAssetId)
      ? await assetToPageImage(familyId, event.coverAssetId!)
      : null;
    const paras: Paragraph[] = [
      {
        kind: "body",
        text: new Intl.DateTimeFormat("zh-CN", {
          dateStyle: "long",
          timeZone: familyRow.timezone,
        }).format(event.occurredAt),
      },
    ];
    if (event.locationText) {
      paras.push({ kind: "body", text: event.locationText });
    }
    chapters.push({ title: event.title, paragraphs: paras, image });
  }
  const book: EpubBook = {
    title,
    author: familyName,
    language: "zh-CN",
    chapters,
  };
  const buffer = await renderLegacyEpubIsolated(book, randomUUID());
  recheck();
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
