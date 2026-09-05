import type { BookEdit, BookLayout } from "@/mobile/src/books/types";
import { parseCalendarDate } from "@/mobile/src/utils/calendar";
export class BookError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function text(v: unknown, max: number, min = 0): v is string {
  return typeof v === "string" && v.trim().length >= min && v.length <= max;
}
export function validateBookLayout(value: unknown): BookLayout {
  const l = value as BookLayout;
  if (
    !l ||
    typeof l !== "object" ||
    Object.keys(l).some((k) => !["breakBefore", "fit", "focus"].includes(k)) ||
    typeof l.breakBefore !== "boolean" ||
    !["contain", "cover"].includes(l.fit) ||
    !Array.isArray(l.focus) ||
    l.focus.length !== 4 ||
    l.focus.some(
      (f) =>
        !f ||
        Object.keys(f).some((k) => !["x", "y"].includes(k)) ||
        !Number.isFinite(f.x) ||
        !Number.isFinite(f.y) ||
        f.x < 0 ||
        f.x > 1 ||
        f.y < 0 ||
        f.y > 1,
    )
  )
    throw new BookError("invalid_layout");
  return {
    breakBefore: l.breakBefore,
    fit: l.fit,
    focus: l.focus.map((f) => ({ x: f.x, y: f.y })),
  };
}
export function validateBookEdit(input: unknown): BookEdit {
  const v = input as BookEdit;
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    !text(v.title, 200, 1) ||
    !text(v.subtitle, 500) ||
    !["photos", "growth", "letters"].includes(v.template) ||
    !["personal", "family"].includes(v.audience) ||
    !["A4", "A5"].includes(v.pageSize)
  )
    throw new BookError("invalid_book");
  for (const d of [v.startDate, v.endDate])
    if (d !== null) {
      try {
        parseCalendarDate(d);
      } catch {
        throw new BookError("invalid_date");
      }
    }
  if (v.startDate && v.endDate && v.startDate > v.endDate)
    throw new BookError("invalid_date_range");
  if (v.coverAssetId !== null && !text(v.coverAssetId, 128, 1))
    throw new BookError("invalid_cover");
  if (
    !Array.isArray(v.chapters) ||
    v.chapters.length > 50 ||
    !Array.isArray(v.blocks) ||
    v.blocks.length > 500 ||
    !Array.isArray(v.sources) ||
    v.sources.length > 2000
  )
    throw new BookError("book_too_large");
  const chapterIds = new Set<string>(),
    blockIds = new Set<string>(),
    sourceIds = new Set<string>();
  for (const chapter of v.chapters) {
    if (
      !chapter ||
      !uuid.test(chapter.id) ||
      chapterIds.has(chapter.id) ||
      !text(chapter.title, 200, 1)
    )
      throw new BookError("invalid_chapter");
    chapterIds.add(chapter.id);
  }
  const kinds = {
    memory: "memoryEventId",
    asset: "assetId",
    contribution: "contributionId",
    story: "storyId",
    collection: "collectionId",
  } as const;
  for (const source of v.sources) {
    if (
      !source ||
      !uuid.test(source.id) ||
      sourceIds.has(source.id) ||
      !Object.hasOwn(kinds, source.kind) ||
      !text(source.fingerprint, 128) ||
      !text(source.label, 500)
    )
      throw new BookError("invalid_source");
    for (const [kind, key] of Object.entries(kinds)) {
      const value = source[key as (typeof kinds)[keyof typeof kinds]];
      if (
        kind === source.kind
          ? value !== null && !text(value, 128, 1)
          : value !== null
      )
        throw new BookError("invalid_source");
    }
    sourceIds.add(source.id);
  }
  for (const block of v.blocks) {
    if (
      !block ||
      !uuid.test(block.id) ||
      blockIds.has(block.id) ||
      !chapterIds.has(block.chapterId) ||
      !["text", "image", "double", "collage", "quote", "date"].includes(
        block.kind,
      ) ||
      !text(block.text, 30000) ||
      !text(block.caption, 2000) ||
      !Array.isArray(block.sourceIds) ||
      block.sourceIds.length > 20 ||
      new Set(block.sourceIds).size !== block.sourceIds.length ||
      block.sourceIds.some((id) => !sourceIds.has(id))
    )
      throw new BookError("invalid_block");
    validateBookLayout(block.layout);
    blockIds.add(block.id);
  }
  if (
    v.blocks.reduce((n, b) => n + b.text.length + b.caption.length, 0) > 500000
  )
    throw new BookError("book_too_large");
  return {
    title: v.title.trim(),
    subtitle: v.subtitle,
    template: v.template,
    audience: v.audience,
    pageSize: v.pageSize,
    startDate: v.startDate,
    endDate: v.endDate,
    coverAssetId: v.coverAssetId,
    chapters: v.chapters.map((c) => ({ id: c.id, title: c.title.trim() })),
    blocks: v.blocks.map((b) => ({
      id: b.id,
      chapterId: b.chapterId,
      kind: b.kind,
      text: b.text,
      caption: b.caption,
      layout: validateBookLayout(b.layout),
      sourceIds: [...b.sourceIds],
    })),
    sources: v.sources.map((s) => ({
      id: s.id,
      kind: s.kind,
      memoryEventId: s.memoryEventId,
      assetId: s.assetId,
      contributionId: s.contributionId,
      storyId: s.storyId,
      collectionId: s.collectionId,
      fingerprint: s.fingerprint,
      label: s.label,
    })),
  };
}
