import type { BookBlock, BookLayout } from "../books/types";
import type { ReaderTranscript } from "../media/types";
export type ReadingKind = "book" | "collection";
export type ReadingBlock = {
  id: string;
  kind: BookBlock["kind"];
  text: string;
  caption: string;
  images: string[];
  layout: BookLayout;
  sourceLabels: string[];
  dateLabel: string;
  author: string | null;
  memoryEventId: string | null;
};
export type ReadingMedia = {
  id: string;
  filename: string;
  type: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  author: string | null;
  dateLabel: string;
  memoryEventId: string | null;
  transcript: ReaderTranscript | null;
};
export type ReadingManifest = {
  schemaVersion: 1;
  kind: ReadingKind;
  id: string;
  revision: number;
  digest: string;
  userId: string;
  familyId: string;
  audience: "family" | "personal";
  title: string;
  subtitle: string;
  timezone: string;
  chapters: { id: string; title: string; blocks: ReadingBlock[] }[];
  media: ReadingMedia[];
  bytes: number;
};
export const READING_LIMITS = {
  files: 500,
  metadataBytes: 8 * 1024 * 1024,
  cacheBytes: 512 * 1024 * 1024,
  globalCacheBytes: 1024 * 1024 * 1024,
};
