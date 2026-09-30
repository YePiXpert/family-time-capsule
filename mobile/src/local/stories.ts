import { yearKey, type Library } from "./model";
export type YearStory = {
  title: string;
  paragraphs: { text: string; recordIds: string[] }[];
  generatedAt: string;
  updatedAt: string;
  edited?: boolean;
};
export function validStories(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([year, raw]) => {
    const v = raw as YearStory;
    return (
      /^\d{4}$/.test(year) &&
      !!v &&
      typeof v.title === "string" &&
      v.title.length <= 100 &&
      Array.isArray(v.paragraphs) &&
      v.paragraphs.length > 0 &&
      v.paragraphs.length <= 12 &&
      v.paragraphs.every(
        (p) =>
          p &&
          typeof p.text === "string" &&
          p.text.length <= 1000 &&
          Array.isArray(p.recordIds) &&
          p.recordIds.length <= 8 &&
          p.recordIds.every((id: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(id)),
      ) &&
      typeof v.generatedAt === "string" &&
      Number.isFinite(Date.parse(v.generatedAt)) &&
      typeof v.updatedAt === "string" &&
      Number.isFinite(Date.parse(v.updatedAt)) &&
      (v.edited === undefined || typeof v.edited === "boolean")
    );
  });
}
export function missingStoryYears(state: Library, now = new Date()): string[] {
  return [
    ...new Set(
      Object.values(state.records)
        .filter((r) => r.title.trim() || r.text.trim())
        .map((r) => yearKey(r.date)),
    ),
  ]
    .filter(
      (year) => Number(year) < now.getFullYear() && !state.yearStories?.[year],
    )
    .sort()
    .reverse();
}
