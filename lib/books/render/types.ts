import type { BookDetail } from "@/mobile/src/books/types";
export const BOOK_TEMPLATE_VERSION = "1.2-layout-2";
export const BOOK_RENDER_LIMITS = {
  pages: 200,
  outputBytes: 256 * 1024 * 1024,
  tempBytes: 512 * 1024 * 1024,
  familyBytes: 2 * 1024 * 1024 * 1024,
  timeoutMs: 180000,
  leaseMs: 240000,
};
export type BookRenderFormat = "pdf" | "epub" | "reading_zip";
export type RenderInput = {
  book: BookDetail;
  format: BookRenderFormat;
  fontPath: string;
  images: Record<
    string,
    { path: string; bytes: number; width: number | null; height: number | null }
  >;
};
export type RenderProgress = (percent: number, pages: number) => void;
