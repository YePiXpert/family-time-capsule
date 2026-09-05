import type { CollectionEdit } from "@/mobile/src/collections/types";
import { parseCalendarDate } from "@/mobile/src/utils/calendar";
export class CollectionError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateCollectionEdit(input: unknown): CollectionEdit {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new CollectionError("invalid_input");
  const value = input as CollectionEdit;
  const text = (v: unknown, max: number, min = 0) =>
    typeof v === "string" && v.trim().length >= min && v.length <= max;
  if (
    !text(value.title, 200, 1) ||
    !text(value.description, 5000) ||
    !["album", "chapter"].includes(value.kind) ||
    !["manual", "time"].includes(value.sortMode)
  )
    throw new CollectionError("invalid_input");
  for (const date of [value.startDate, value.endDate])
    if (date !== null) {
      try {
        parseCalendarDate(date);
      } catch {
        throw new CollectionError("invalid_date");
      }
    }
  if (value.startDate && value.endDate && value.startDate > value.endDate)
    throw new CollectionError("invalid_date_range");
  if (value.coverAssetId !== null && !text(value.coverAssetId, 128, 1))
    throw new CollectionError("invalid_cover");
  if (
    !Array.isArray(value.sections) ||
    value.sections.length > 20 ||
    !Array.isArray(value.items) ||
    value.items.length > 500
  )
    throw new CollectionError("collection_too_large");
  const sections = new Set<string>(),
    items = new Set<string>(),
    sources = new Set<string>();
  for (const s of value.sections) {
    if (!s || !uuid.test(s.id) || sections.has(s.id) || !text(s.title, 200, 1))
      throw new CollectionError("invalid_section");
    sections.add(s.id);
  }
  if (value.kind === "album" && sections.size)
    throw new CollectionError("album_has_no_sections");
  for (const item of value.items) {
    if (
      !item ||
      !uuid.test(item.id) ||
      items.has(item.id) ||
      !text(item.caption, 2000) ||
      (item.sectionId !== null && !sections.has(item.sectionId))
    )
      throw new CollectionError("invalid_item");
    items.add(item.id);
    if (item.memoryEventId !== null) {
      if (!text(item.memoryEventId, 128, 1) || sources.has(item.memoryEventId))
        throw new CollectionError("duplicate_source");
      sources.add(item.memoryEventId);
    }
  }
  return {
    title: value.title.trim(),
    kind: value.kind,
    description: value.description,
    coverAssetId: value.coverAssetId,
    startDate: value.startDate,
    endDate: value.endDate,
    sortMode: value.sortMode,
    sections: value.sections.map(({ id, title }) => ({
      id,
      title: title.trim(),
    })),
    items: value.items.map(({ id, memoryEventId, sectionId, caption }) => ({
      id,
      memoryEventId,
      sectionId,
      caption,
    })),
  };
}
