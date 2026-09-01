import "server-only";

import type { Paragraph, PageImage } from "./layout";

/**
 * EPUB 3 生成器（M6）：XHTML 章节 + 内嵌 JPEG 图像。
 * 标准阅读器自带字体（Unicode 文本无需嵌字体）；媒体作为专用 JPEG derivative
 * 内嵌于 ZIP——不引用任何内部鉴权 URL。
 */

export type EpubChapter = {
  title: string;
  paragraphs: Paragraph[];
  image: PageImage | null;
};

export type EpubBook = {
  title: string;
  author: string;
  language: string;
  chapters: EpubChapter[];
};

function escapeXml(s: string): string {
  return s
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function chapterXhtml(chapter: EpubChapter, index: number): string {
  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="utf-8"?>`);
  parts.push(
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN">`,
  );
  parts.push(`<head><title>${escapeXml(chapter.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>`);
  parts.push(`<body>`);
  if (index === 0) {
    parts.push(`<h1 class="book-title">${escapeXml(chapter.title)}</h1>`);
  } else {
    parts.push(`<h1 class="chapter-title">${escapeXml(chapter.title)}</h1>`);
  }
  if (chapter.image) {
    parts.push(
      `<div class="figure"><img src="images/ch${index}.jpg" alt="${escapeXml(chapter.title)}"/></div>`,
    );
  }
  for (const p of chapter.paragraphs) {
    if (p.kind === "title") continue; // 书名已在 h1
    if (p.kind === "heading") continue; // 章节标题已在 h1
    parts.push(
      p.kind === "quote"
        ? `<blockquote>${escapeXml(p.text)}</blockquote>`
        : `<p>${escapeXml(p.text)}</p>`,
    );
  }
  parts.push(`</body></html>`);
  return parts.join("\n");
}

const STYLE_CSS = `body { font-family: serif; line-height: 1.8; margin: 1em; }
h1.book-title { font-size: 1.8em; text-align: center; margin: 3em 0 1em; }
h1.chapter-title { font-size: 1.4em; margin-top: 2em; }
blockquote { border-left: 0.25em solid #bbb; margin-left: 0; padding-left: 1em; color: #333; }
.figure { text-align: center; margin: 1em 0; }
.figure img { max-width: 100%; }`;

function navXhtml(book: EpubBook): string {
  const items = book.chapters
    .map(
      (c, i) =>
        `<li><a href="chapter${i}.xhtml">${escapeXml(c.title)}</a></li>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head>
<body>
<nav epub:type="toc" id="toc">
<h1>目录</h1>
<ol>
${items}
</ol>
</nav>
</body>
</html>`;
}

function contentOpf(book: EpubBook, bookUuid: string): string {
  const manifestItems = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="css" href="style.css" media-type="text/css"/>`,
  ];
  const spineItems = [`<itemref idref="nav"/>`];
  book.chapters.forEach((c, i) => {
    manifestItems.push(
      `<item id="ch${i}" href="chapter${i}.xhtml" media-type="application/xhtml+xml"/>`,
    );
    spineItems.push(`<itemref idref="ch${i}"/>`);
    if (c.image) {
      manifestItems.push(
        `<item id="img${i}" href="images/ch${i}.jpg" media-type="image/jpeg"/>`,
      );
    }
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">urn:uuid:${bookUuid}</dc:identifier>
<dc:title>${escapeXml(book.title)}</dc:title>
<dc:creator>${escapeXml(book.author)}</dc:creator>
<dc:language>${escapeXml(book.language)}</dc:language>
<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
</metadata>
<manifest>
${manifestItems.join("\n")}
</manifest>
<spine>
${spineItems.join("\n")}
</spine>
</package>`;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>`;

export async function renderEpub(book: EpubBook, bookUuid: string): Promise<Buffer> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  // mimetype 必须第一个且不压缩
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("OEBPS/content.opf", contentOpf(book, bookUuid));
  zip.file("OEBPS/nav.xhtml", navXhtml(book));
  zip.file("OEBPS/style.css", STYLE_CSS);
  for (let i = 0; i < book.chapters.length; i++) {
    const chapter = book.chapters[i];
    zip.file(`OEBPS/chapter${i}.xhtml`, chapterXhtml(chapter, i));
    if (chapter.image) {
      // data URI → 二进制
      const base64 = chapter.image.dataUri.split(",")[1] ?? "";
      zip.file(`OEBPS/images/ch${i}.jpg`, Buffer.from(base64, "base64"), {
        compression: "STORE",
      });
    }
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
