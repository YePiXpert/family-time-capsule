import { ZipArchive } from "archiver";
import { createReadStream, createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import type { BookBlock } from "@/mobile/src/books/types";
import { renderBookImage } from "./images";
import {
  BOOK_RENDER_LIMITS,
  type RenderInput,
  type RenderProgress,
} from "./types";
/** XML/HTML text is escaped, never interpreted as a template or script. */
export function escapeBookText(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "�")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
const style = `body{font-family:serif;line-height:1.8;margin:1.2em;color:#302924;background:#fffaf4}h1,h2{line-height:1.4;overflow-wrap:anywhere}h1{font-size:1.8em}p{white-space:pre-wrap;overflow-wrap:anywhere}img{max-width:100%;height:auto}figure{margin:1em 0}figcaption,.source,.notice{font-size:.85em;color:#695d54}blockquote{margin:1em 0;padding-left:1em;border-left:.2em solid #b78970}.grid{display:flex;gap:1em;flex-wrap:wrap}.grid figure{flex:1 1 40%;min-width:0}.photos figure{margin:1.5em 0}.letters blockquote{font-size:1.12em}.date{color:#7b4f37}.cover{padding:2em 0}.chapter{margin:3em 0}audio,video{max-width:100%}a{color:#8e5135}`;
function xhtml(title: string, body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN"><head><title>${escapeBookText(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`;
}
export async function renderBookEpub(
  input: RenderInput,
  outputPath: string,
  progress: RenderProgress,
): Promise<number> {
  const reading = input.format === "reading_zip",
    html: string[] = [];
  const book = input.book,
    zip = new ZipArchive({ zlib: { level: 6 } }),
    output = createWriteStream(outputPath, { flags: "wx" }),
    complete = finished(output);
  zip.pipe(output);
  zip.on("error", (e) => output.destroy(e));
  const assets: { id: string; href: string; type: string }[] = [],
    spine: { id: string; href: string; title: string }[] = [];
  let imageIndex = 0;
  function append(name: string, content: string) {
    zip.append(content, { name });
  }
  async function image(
    assetId: string,
    caption: string,
    block?: BookBlock,
    slot = 0,
  ) {
    const id = `image-${++imageIndex}`,
      href = `images/${id}.jpg`;
    const bytes = await renderBookImage(
      input,
      assetId,
      1600,
      1600,
      block,
      slot,
    );
    zip.append(bytes, { name: `${reading ? "" : "OEBPS/"}${href}` });
    assets.push({ id, href, type: "image/jpeg" });
    return `<figure><img src="${href}" alt="${escapeBookText(caption || "作品照片")}"/>${caption ? `<figcaption>${escapeBookText(caption)}</figcaption>` : ""}</figure>`;
  }
  try {
    if (!reading) {
      zip.append("application/epub+zip", { name: "mimetype", store: true });
      append(
        "META-INF/container.xml",
        '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      );
    }
    append(reading ? "style.css" : "OEBPS/style.css", style);
    let cover = `<section class="cover"><p>${book.audience === "family" ? "家庭可读版" : "私人阅读版"}</p><h1>${escapeBookText(book.title)}</h1><p>${escapeBookText(book.subtitle)}</p><p>${escapeBookText([book.startDate, book.endDate].filter(Boolean).join(" — "))}</p>`;
    if (book.coverAssetId) cover += await image(book.coverAssetId, "封面照片");
    cover +=
      '<p class="notice">音视频请在作品或精选阅读包中播放。本 EPUB 不是完整可恢复备份。</p></section>';
    if (reading) {
      cover = cover.replace(
        "音视频请在作品或精选阅读包中播放。本 EPUB 不是完整可恢复备份。",
        "精选阅读包：包含本次允许导出的内容，接收者可以保存或转发，下载副本无法远程收回。这不是完整可恢复备份。音视频能否播放取决于本机编解码器，也可用本地播放器打开。",
      );
      html.push(cover);
    } else append("OEBPS/cover.xhtml", xhtml(book.title, cover));
    spine.push({ id: "cover", href: "cover.xhtml", title: "封面" });
    for (const [index, chapter] of book.chapters.entries()) {
      let body = `<section id="chapter-${index}" class="chapter ${book.template}"><h1>${escapeBookText(chapter.title)}</h1>`;
      const blocks = book.blocks.filter((b) => b.chapterId === chapter.id);
      if (!blocks.length) body += "<p>本章尚未选入内容。</p>";
      for (const block of blocks) {
        if (block.kind === "date" || block.kind === "quote") {
          const dates = [
            ...new Set(
              block.sourceIds.flatMap((id) => {
                const s = book.sourceStates[id];
                return s?.occurredAt
                  ? [
                      `${new Intl.DateTimeFormat("zh-CN", { timeZone: book.timezone, dateStyle: "long" }).format(new Date(s.occurredAt))}${s.ageLabel ? " · " + s.ageLabel : ""}`,
                    ]
                  : [];
              }),
            ),
          ];
          body += `<p class="date">${escapeBookText(dates.join(" / "))}</p>`;
        }
        if (["image", "double", "collage"].includes(block.kind)) {
          const refs = block.sourceIds
            .flatMap((id) => {
              const a = book.sourceStates[id]?.asset;
              return a?.type === "image" ? [a] : [];
            })
            .slice(
              0,
              block.kind === "double" ? 2 : block.kind === "collage" ? 4 : 1,
            );
          body += '<div class="grid">';
          for (const [slot, ref] of refs.entries())
            body += await image(
              ref.id,
              block.caption || ref.filename,
              block,
              slot,
            );
          body += "</div>";
        }
        if (block.text.trim())
          body +=
            block.kind === "quote"
              ? `<blockquote><p>${escapeBookText(block.text)}</p></blockquote>`
              : `<p>${escapeBookText(block.text)}</p>`;
        const author = block.sourceIds
          .map((id) => book.sourceStates[id]?.author)
          .find(Boolean);
        if (block.kind === "quote" && author)
          body += `<p>—— ${escapeBookText(author)}</p>`;
        if (block.kind === "quote") {
          const authored = block.sourceIds
            .map((id) => book.sourceStates[id]?.authoredAt)
            .find(Boolean);
          if (authored)
            body += `<p class="source">讲述于 ${escapeBookText(new Intl.DateTimeFormat("zh-CN", { timeZone: book.timezone, dateStyle: "long" }).format(new Date(authored)))}</p>`;
        }
        if (block.caption)
          body += `<p class="source">${escapeBookText(block.caption)}</p>`;
        const labels = [
          ...new Set(
            block.sourceIds
              .map((id) => book.sourceStates[id]?.label)
              .filter(Boolean),
          ),
        ];
        if (labels.length)
          body += `<p class="source">来源：${escapeBookText(labels.join("、"))}</p>`;
      }
      body += "</section>";
      const id = `chapter-${index}`,
        href = `${id}.xhtml`;
      if (reading) html.push(body);
      else append(`OEBPS/${href}`, xhtml(chapter.title, body));
      spine.push({ id, href, title: chapter.title });
      progress(
        10 + Math.floor(((index + 1) / Math.max(1, book.chapters.length)) * 80),
        index + 1,
      );
    }
    if (reading) {
      const media = input.media ?? [];
      if (
        media.length > 500 ||
        media.reduce((sum, m) => sum + m.bytes, 0) >
          BOOK_RENDER_LIMITS.outputBytes - 16 * 1024 * 1024
      )
        throw new Error("output_limit_exceeded");
      const extensions: Record<string, string> = {
        "video/mp4": "mp4",
        "video/quicktime": "mov",
        "video/webm": "webm",
        "audio/mpeg": "mp3",
        "audio/mp4": "m4a",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/ogg": "ogg",
        "audio/webm": "webm",
        "application/pdf": "pdf",
        "text/plain": "txt",
        "text/markdown": "md",
        "application/rtf": "rtf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
          "docx",
      };
      if (media.length)
        html.push(
          '<section class="chapter"><h2>随册媒体与文档</h2><p>仅包括当前读者允许阅读的来源媒体。播放器按需加载。</p>',
        );
      for (const [index, m] of media.entries()) {
        const href = `media/attachment-${index}.${extensions[m.mimeType] ?? "bin"}`;
        zip.append(createReadStream(m.path), { name: href });
        html.push(
          `<figure><figcaption>${escapeBookText(m.label)} · ${escapeBookText(m.filename)}</figcaption>${m.type === "audio" ? `<audio controls="controls" preload="none" src="${href}"></audio>` : m.type === "video" ? `<video controls="controls" preload="none" src="${href}"></video>` : ""}<p><a href="${href}" download="download">保存媒体副本</a></p></figure>`,
        );
      }
      if (media.length) html.push("</section>");
      const sources = Object.values(book.sourceStates).map(
        (s) =>
          `${s.label}${s.occurredAt ? ` · ${new Intl.DateTimeFormat("zh-CN", { timeZone: book.timezone, dateStyle: "long" }).format(new Date(s.occurredAt))}` : ""}`,
      );
      html.push(
        `<section class="chapter"><h2>来源</h2><ul>${sources.map((s) => `<li>${escapeBookText(s)}</li>`).join("")}</ul></section>`,
      );
      const toc = `<nav aria-label="目录"><h2>目录</h2><ol>${book.chapters.map((c, i) => `<li><a href="#chapter-${i}">${escapeBookText(c.title)}</a></li>`).join("")}</ol></nav>`;
      append(
        "index.html",
        `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; media-src file:; style-src file:; base-uri 'none'; form-action 'none'"><title>${escapeBookText(book.title)} · 精选阅读包</title><link rel="stylesheet" href="style.css"></head><body>${html[0]}${toc}${html.slice(1).join("\n")}</body></html>`,
      );
      append("sources.txt", sources.join("\n"));
      append(
        "阅读说明.txt",
        "精选阅读包。解压后用浏览器打开 index.html，无需登录或网络。音视频格式支持由本机决定。接收者可以保存、转发，下载副本无法远程收回。这不是完整可恢复备份。完整备份请由家庭管理员另行导出。",
      );
      await zip.finalize();
      await complete;
      progress(95, book.chapters.length);
      return book.chapters.length;
    }
    append(
      "OEBPS/nav.xhtml",
      xhtml(
        "目录",
        `<nav epub:type="toc" id="toc"><h1>目录</h1><ol>${spine.map((s) => `<li><a href="${s.href}">${escapeBookText(s.title)}</a></li>`).join("")}</ol></nav>`,
      ),
    );
    const modified = new Date(book.updatedAt)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
    append(
      "OEBPS/package.opf",
      `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="zh-CN"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:family-time-capsule:book:${book.id}:revision:${book.revision}</dc:identifier><dc:title>${escapeBookText(book.title)}</dc:title><dc:language>zh-CN</dc:language><dc:creator>家庭成员</dc:creator><meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="style" href="style.css" media-type="text/css"/>${spine.map((s) => `<item id="${s.id}" href="${s.href}" media-type="application/xhtml+xml"/>`).join("")}${assets.map((a) => `<item id="${a.id}" href="${a.href}" media-type="${a.type}"/>`).join("")}</manifest><spine><itemref idref="nav"/>${spine.map((s) => `<itemref idref="${s.id}"/>`).join("")}</spine></package>`,
    );
    await zip.finalize();
    await complete;
    progress(95, spine.length);
    return spine.length;
  } catch (e) {
    zip.abort();
    output.destroy();
    await complete.catch(() => {});
    throw e;
  }
}
