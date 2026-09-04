/**
 * 上传校验（Issue #005，docs/SECURITY.md §8）：
 * - MIME 只信白名单 + 内容魔数嗅探，extension 不可信（由 MIME 反推）；
 * - 大小硬限制；
 * - 文件名只作展示。
 */

export const MAX_IMAGE_BYTES = 50 * 1024 * 1024; // 50MB
export const MAX_AUDIO_BYTES = 200 * 1024 * 1024; // 200MB
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500MB
export const MAX_DOCUMENT_BYTES = 200 * 1024 * 1024; // 独立于音视频限制

/** P0 图片白名单：常见手机/相机格式 */
export const IMAGE_MIME_WHITELIST: Set<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/avif",
] as const);

/** P0 音频白名单：系统录音 App 常见格式 */
export const AUDIO_MIME_WHITELIST: Set<string> = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
] as const);

/** P0 视频白名单 */
export const VIDEO_MIME_WHITELIST: Set<string> = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/3gpp",
] as const);

/** Documents are archived as inert originals. HTML/SVG are intentionally absent. */
export const DOCUMENT_MIME_WHITELIST: Set<string> = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/rtf",
  "application/rtf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const);

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/rtf": "rtf",
  "application/rtf": "rtf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

export type UploadAssetType = "image" | "audio" | "video" | "document";

export function normalizeUploadMime(declaredMime: string): string {
  return declaredMime.split(";", 1)[0].trim().toLowerCase();
}

export function classifyDeclaredUpload(
  declaredMime: string,
): { type: UploadAssetType; mimeType: string; extension: string; maxBytes: number } | null {
  const mimeType = normalizeUploadMime(declaredMime);
  if (IMAGE_MIME_WHITELIST.has(mimeType)) {
    return { type: "image", mimeType, extension: MIME_TO_EXTENSION[mimeType] ?? "bin", maxBytes: MAX_IMAGE_BYTES };
  }
  if (AUDIO_MIME_WHITELIST.has(mimeType)) {
    return { type: "audio", mimeType, extension: MIME_TO_EXTENSION[mimeType] ?? "bin", maxBytes: MAX_AUDIO_BYTES };
  }
  if (VIDEO_MIME_WHITELIST.has(mimeType)) {
    return { type: "video", mimeType, extension: MIME_TO_EXTENSION[mimeType] ?? "bin", maxBytes: MAX_VIDEO_BYTES };
  }
  if (DOCUMENT_MIME_WHITELIST.has(mimeType)) {
    return { type: "document", mimeType, extension: MIME_TO_EXTENSION[mimeType] ?? "bin", maxBytes: MAX_DOCUMENT_BYTES };
  }
  return null;
}

function looksLikeSafeText(prefix: Buffer): boolean {
  if (prefix.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(prefix);
    return true;
  } catch {
    return false;
  }
}

/** Validate a complete file using only its trusted length and a small prefix. */
export function validateUploadPrefix(
  prefix: Buffer,
  declaredMime: string,
  totalBytes: number,
): { ok: true; value: NonNullable<ReturnType<typeof classifyDeclaredUpload>> } | { ok: false; error: UploadValidationFailure } {
  if (totalBytes <= 0) return { ok: false, error: "empty" };
  const declared = classifyDeclaredUpload(declaredMime);
  if (!declared) return { ok: false, error: "mime_not_allowed" };
  if (totalBytes > declared.maxBytes) return { ok: false, error: "too_large" };

  if (declared.type === "image") {
    const sniffed = sniffImageMime(prefix);
    const family = (mime: string) => mime === "image/heif" ? "image/heic" : mime;
    if (!sniffed || family(sniffed) !== family(declared.mimeType)) {
      return { ok: false, error: "content_mismatch" };
    }
  } else if (declared.type === "audio" || declared.type === "video") {
    const sniffed = sniffAudioMime(prefix) ?? sniffVideoMime(prefix);
    if (!sniffed) return { ok: false, error: "content_mismatch" };
    if (
      sniffFamily(sniffed) !== declared.type &&
      !sameContainerFamily(declared.mimeType, sniffed)
    ) {
      return { ok: false, error: "content_mismatch" };
    }
  } else {
    const mime = declared.mimeType;
    const matches =
      (mime === "application/pdf" && prefix.subarray(0, 5).toString("ascii") === "%PDF-") ||
      (mime.endsWith("wordprocessingml.document") && prefix.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) ||
      ((mime === "text/rtf" || mime === "application/rtf") && prefix.subarray(0, 5).toString("ascii") === "{\\rtf") ||
      ((mime === "text/plain" || mime === "text/markdown") && looksLikeSafeText(prefix));
    if (!matches) return { ok: false, error: "content_mismatch" };
  }
  return { ok: true, value: declared };
}

/** 按内容前几个字节判断真实图片类型；无法识别返回 null */
export function sniffImageMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  // GIF: GIF87a / GIF89a
  if (buffer.subarray(0, 3).toString("ascii") === "GIF") {
    return "image/gif";
  }
  // RIFF....WEBP
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  // ISO-BMFF: ....ftyp + 品牌。HEIC 家族精确到 heic/heif（声明族一致即可通过）
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    if (["heic", "heix", "hevc"].includes(brand)) return "image/heic";
    if (["heif", "mif1", "msf1"].includes(brand)) return "image/heif";
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return null;
}

/** 音频魔数嗅探：mp3(ID3/帧同步)、wav、m4a/aac、webm、ogg、flac */
export function sniffAudioMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 3).toString("ascii") === "ID3") return "audio/mpeg";
  // MP3 帧同步 FF Ex/C/D/E/F x
  if (
    buffer[0] === 0xff &&
    (buffer[1] & 0xe0) === 0xe0 &&
    (buffer[1] & 0x06) !== 0x00 // 排除 layer 无效值，进一步限定为音频帧
  ) {
    return "audio/mpeg";
  }
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WAVE") {
    return "audio/wav";
  }
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    if (["M4A ", "M4B ", "M4P "].includes(brand)) return "audio/mp4";
  }
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return "audio/webm"; // EBML：webm 音频或视频，视频声明族会在同族校验中纠正
  }
  if (buffer.subarray(0, 4).toString("ascii") === "OggS") return "audio/ogg";
  if (buffer.subarray(0, 4).toString("ascii") === "fLaC") return "audio/flac";
  return null;
}

/** 视频魔数嗅探：mp4/mov（ftyp）、webm/mkv（EBML） */
export function sniffVideoMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    if (brand === "qt  ") return "video/quicktime";
    return "video/mp4";
  }
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return "video/webm";
  }
  return null;
}

export type UploadValidationFailure =
  | "too_large"
  | "mime_not_allowed"
  | "content_mismatch"
  | "empty";

export type ValidatedMedia = {
  mimeType: string;
  extension: string;
};

function sniffFamily(sniffed: string): "image" | "audio" | "video" | null {
  if (sniffed.startsWith("image/")) return "image";
  if (sniffed.startsWith("audio/")) return "audio";
  if (sniffed.startsWith("video/")) return "video";
  return null;
}

/**
 * 通用上传校验（#011）：audio / video 声明 MIME 必须在对应白名单，
 * 且内容魔数与声明同族。EBML 同嗅为 audio/webm，声明的 webm 家族按族放行后
 * 统一按声明类型入库。
 */
export function validateMediaUpload(
  buffer: Buffer,
  declaredMime: string,
  kind: "audio" | "video",
): { ok: true; value: ValidatedMedia } | { ok: false; error: UploadValidationFailure } {
  if (buffer.length === 0) return { ok: false, error: "empty" };
  const maxBytes = kind === "audio" ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES;
  if (buffer.length > maxBytes) return { ok: false, error: "too_large" };
  const normalized = declaredMime.split(";")[0].trim().toLowerCase();
  const whitelist = kind === "audio" ? AUDIO_MIME_WHITELIST : VIDEO_MIME_WHITELIST;
  if (!whitelist.has(normalized)) return { ok: false, error: "mime_not_allowed" };

  const sniffedAudio = sniffAudioMime(buffer);
  const sniffedVideo = sniffVideoMime(buffer);
  if (!sniffedAudio && !sniffedVideo) {
    return { ok: false, error: "content_mismatch" };
  }
  const sniffed = sniffedAudio ?? sniffedVideo!;
  const sniffedFamily = sniffFamily(sniffed);
  const declaredFamily = sniffFamily(normalized);
  // 族必须一致；唯一例外是 EBML 家族（webm/mkv 的音视频声明可互换）
  const containerInterchangeable =
    sameContainerFamily(normalized, sniffed) || sameContainerFamily(sniffed, normalized);
  if (sniffedFamily !== declaredFamily && !containerInterchangeable) {
    return { ok: false, error: "content_mismatch" };
  }
  return {
    ok: true,
    value: { mimeType: normalized, extension: MIME_TO_EXTENSION[normalized] ?? "bin" },
  };
}

/** 同容器家族：webm/mkv 音视频共享 EBML 容器 */
function sameContainerFamily(declared: string, sniffed: string): boolean {
  const webmish = new Set(["audio/webm", "video/webm", "video/x-matroska"]);
  return webmish.has(declared) && webmish.has(sniffed);
}

/**
 * 校验上传图片：声明 MIME 必须在白名单内，且内容魔数与声明一致。
 * HEIC/HEIF 声明为 image/heic（嗅探不区分 heic/heif 子品牌，扩展名统一 heic）。
 */
export function validateImageUpload(
  buffer: Buffer,
  declaredMime: string,
): { ok: true; value: ValidatedMedia } | { ok: false; error: UploadValidationFailure } {
  if (buffer.length === 0) return { ok: false, error: "empty" };
  if (buffer.length > MAX_IMAGE_BYTES) return { ok: false, error: "too_large" };
  const normalized = declaredMime.split(";")[0].trim().toLowerCase();
  if (!IMAGE_MIME_WHITELIST.has(normalized)) {
    return { ok: false, error: "mime_not_allowed" };
  }
  const sniffed = sniffImageMime(buffer);
  if (!sniffed) return { ok: false, error: "content_mismatch" };
  // 声明与内容必须同族（heic/heif 互通）
  const family = (m: string) =>
    m === "image/heif" ? "image/heic" : m;
  if (family(sniffed) !== family(normalized)) {
    return { ok: false, error: "content_mismatch" };
  }
  return {
    ok: true,
    value: { mimeType: normalized, extension: MIME_TO_EXTENSION[normalized] ?? "bin" },
  };
}

export type ImageDimensions = { width: number; height: number };

/** 轻量尺寸解析（不引依赖）：PNG/GIF/JPEG/WebP；失败返回 null（不影响入库） */
export function parseImageSize(
  buffer: Buffer,
  mimeType: string,
): ImageDimensions | null {
  try {
    switch (mimeType) {
      case "image/png":
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
      case "image/gif":
        return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
      case "image/jpeg":
        return parseJpegSize(buffer);
      case "image/webp":
        return parseWebpSize(buffer);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function parseJpegSize(buffer: Buffer): ImageDimensions | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    // SOF0-SOF15（跳过 DHT/DAC/RST 等）
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    const size = buffer.readUInt16BE(offset + 2);
    offset += 2 + size;
  }
  return null;
}

function parseWebpSize(buffer: Buffer): ImageDimensions | null {
  const format = buffer.subarray(12, 16).toString("ascii");
  if (format === "VP8 ") {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (format === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (format === "VP8X") {
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
    return { width, height };
  }
  return null;
}
