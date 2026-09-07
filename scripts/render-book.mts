import { readFile, stat, writeFile } from "node:fs/promises";
import { renderEpub } from "../lib/books/epub";
import { BOOK_RENDER_LIMITS } from "../lib/books/render/types";
import { renderLegacyPages } from "../lib/books/render/legacy-pdf";
import { renderBookPdf } from "../lib/books/render/pdf";
import { renderBookEpub } from "../lib/books/render/epub";
import type { RenderInput } from "../lib/books/render/types";
import { validateBookEdit } from "../lib/books/projects/validation";
const [inputPath, outputPath] = process.argv.slice(2);
const deadline = setTimeout(
  () => process.exit(124),
  BOOK_RENDER_LIMITS.timeoutMs,
);
const toErrorCode = (e: unknown) =>
  e instanceof Error && /^[a-z_]+(?:_U[0-9A-F]+)?$/.test(e.message)
    ? e.message
    : "render_failed";
// 兜底：任何从异步栈逃逸的异常也按单行协议输出并退出，
// 不让未捕获栈迹撑爆父进程的 stderr 预算（会被误判 invalid_worker_output）。
process.on("uncaughtException", (e) => {
  try {
    process.stdout.write(JSON.stringify({ error: toErrorCode(e) }) + "\n");
  } catch {
    // stdout 已不可用则只能退出
  }
  process.exit(1);
});
try {
  if (
    !inputPath ||
    !outputPath ||
    (await stat(inputPath)).size > 24 * 1024 * 1024
  )
    throw new Error("invalid_render_input");
  const raw = JSON.parse(await readFile(inputPath, "utf8"));
  if (raw.kind === "legacy_pdf" || raw.format === "pdf") {
    if (!(await stat(raw.fontPath).catch(() => null))?.isFile())
      throw new Error("font_missing");
  }
  if (raw.kind === "legacy_epub") {
    if (!Array.isArray(raw.book?.chapters) || raw.book.chapters.length > 200)
      throw new Error("page_limit_exceeded");
    const bytes = await renderEpub(raw.book, raw.uuid);
    if (bytes.length > BOOK_RENDER_LIMITS.outputBytes)
      throw new Error("output_limit_exceeded");
    await writeFile(outputPath, bytes, { flag: "wx" });
    process.stdout.write(
      JSON.stringify({
        progress: 100,
        pages: raw.book.chapters.length,
        complete: true,
      }) + "\n",
    );
  } else if (raw.kind === "legacy_pdf") {
    const pages = await renderLegacyPages(raw.pages, raw.fontPath, outputPath);
    process.stdout.write(
      JSON.stringify({ progress: 100, pages, complete: true }) + "\n",
    );
  } else {
    const input = raw as RenderInput;
    validateBookEdit(input.book);
    const progress = (percent: number, pages: number) =>
      process.stdout.write(JSON.stringify({ progress: percent, pages }) + "\n");
    const pages =
      input.format === "pdf"
        ? await renderBookPdf(input, outputPath, progress)
        : (input.format === "epub" || input.format === "reading_zip")
          ? await renderBookEpub(input, outputPath, progress)
          : (() => {
              throw new Error("unsupported_format");
            })();
    process.stdout.write(
      JSON.stringify({ progress: 100, pages, complete: true }) + "\n",
    );
  }
} catch (e) {
  const code = toErrorCode(e);
  process.stdout.write(JSON.stringify({ error: code }) + "\n");
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
}
