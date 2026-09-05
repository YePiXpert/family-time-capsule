import { ZipArchive } from "archiver";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import type { BookBlock } from "@/mobile/src/books/types";
import { renderBookImage } from "./images";
import type { RenderInput, RenderProgress } from "./types";
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
    zip.append(bytes, { name: `OEBPS/${href}` });
    assets.push({ id, href, type: "image/jpeg" });
    return `<figure><img src="${href}" alt="${escapeBookText(caption || "作品照片")}"/>${caption ? `<figcaption>${escapeBookText(caption)}</figcaption>` : ""}</figure>`;
  }
  try {
    zip.append("application/epub+zip", { name: "mimetype", store: true });
    append(
      "META-INF/container.xml",
      '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    );
    append("OEBPS/style.css", style);
    let cover = `<section class="cover"><p>${book.audience === "family" ? "家庭可读版" : "私人阅读版"}</p><h1>${escapeBookText(book.title)}</h1><p>${escapeBookText(book.subtitle)}</p><p>${escapeBookText([book.startDate, book.endDate].filter(Boolean).join(" — "))}</p>`;
    if (book.coverAssetId) cover += await image(book.coverAssetId, "封面照片");
    cover +=
      '<p class="notice">音视频请在作品或精选阅读包中播放。本 EPUB 不是完整可恢复备份。</p></section>';
    append("OEBPS/cover.xhtml", xhtml(book.title, cover));
    spine.push({ id: "cover", href: "cover.xhtml", title: "封面" });
    for (const [index, chapter] of book.chapters.entries()) {
      let body = `<section class="chapter ${book.template}"><h1>${escapeBookText(chapter.title)}</h1>`;
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
          const authored = block.sourceIds.map(id => book.sourceStates[id]?.authoredAt).find(Boolean);
          if (authored) body += `<p class="source">讲述于 ${escapeBookText(new Intl.DateTimeFormat("zh-CN", {timeZone: book.timezone, dateStyle: "long"}).format(new Date(authored)))}</p>`;
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
      append(`OEBPS/${href}`, xhtml(chapter.title, body));
      spine.push({ id, href, title: chapter.title });
      progress(
        10 + Math.floor(((index + 1) / Math.max(1, book.chapters.length)) * 80),
        index + 1,
      );
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
