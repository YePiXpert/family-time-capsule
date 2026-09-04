import type { MediaCapturePayload } from "../types";

const DOCUMENT_MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  rtf: "application/rtf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function classifyImportedFile(filename: string, declaredMime?: string | null): {
  mimeType: string;
  mediaType: MediaCapturePayload["mediaType"];
} | null {
  const mime = declaredMime?.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  const extension = filename.match(/\.([a-z0-9]{1,8})$/iu)?.[1]?.toLowerCase() ?? "";
  if (["image/svg+xml", "text/html", "application/xhtml+xml"].includes(mime)) return null;
  if (mime.startsWith("image/")) return { mimeType: mime, mediaType: "image" };
  if (mime.startsWith("video/")) return { mimeType: mime, mediaType: "video" };
  if (mime.startsWith("audio/")) return { mimeType: mime, mediaType: "audio" };
  const documentMime = DOCUMENT_MIME_BY_EXTENSION[extension];
  if (documentMime && (!mime || mime === "application/octet-stream" ||
    mime === documentMime || (extension === "rtf" && mime === "text/rtf"))) {
    return { mimeType: documentMime, mediaType: "document" };
  }
  if (Object.values(DOCUMENT_MIME_BY_EXTENSION).includes(mime) &&
    (mime !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || extension === "docx")) {
    return { mimeType: mime, mediaType: "document" };
  }
  return null;
}
