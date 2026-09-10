import type { MediaCapturePayload } from "../types";

const DOCUMENT_MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  rtf: "application/rtf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const MEDIA_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif", webp: "image/webp", gif: "image/gif", avif: "image/avif",
  mpg: "video/mpeg", mpeg: "video/mpeg", mpe: "video/mpeg", m1v: "video/mpeg", m2v: "video/mpeg",
  ts: "video/mp2t", mts: "video/mp2t", m2t: "video/mp2t", m2ts: "video/mp2t",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", qt: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", "3gp": "video/3gpp",
  m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", aac: "audio/aac",
};

export function classifyImportedFile(filename: string, declaredMime?: string | null): {
  mimeType: string;
  mediaType: MediaCapturePayload["mediaType"];
} | null {
  let mime = declaredMime?.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  const extension = filename.match(/\.([a-z0-9]{1,8})$/iu)?.[1]?.toLowerCase() ?? "";
  // Files, Android providers and shared videos commonly omit MIME or send a
  // generic type. This is only an intake hint; the server still checks bytes.
  if (!mime || ["application/octet-stream", "binary/octet-stream", "video/*", "audio/*", "image/*"].includes(mime)) mime = MEDIA_MIME_BY_EXTENSION[extension] ?? mime;
  if (["video/mov", "video/x-quicktime"].includes(mime)) mime = "video/quicktime";
  if (["video/mpg", "video/mpeg2", "video/x-mpeg", "video/x-mpeg2", "application/mpeg", "application/x-mpeg"].includes(mime)) mime = "video/mpeg";
  if (["video/mpegts", "video/x-mpegts", "video/mp2ts"].includes(mime)) mime = "video/mp2t";
  if (mime === "video/x-m4v") mime = "video/mp4";
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
