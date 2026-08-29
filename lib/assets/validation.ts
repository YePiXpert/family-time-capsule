/**
 * 上传校验（Issue #005，docs/SECURITY.md §8）：
 * - MIME 只信白名单 + 内容魔数嗅探，extension 不可信（由 MIME 反推）；
 * - 大小硬限制；
 * - 文件名只作展示。
 */

export const MAX_IMAGE_BYTES = 50 * 1024 * 1024; // 50MB

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

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
};

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
  // ISO-BMFF: ....ftypheic / heix / hevc / heif / mif1 / msf1 / avif
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    if (["heic", "heix", "hevc", "heif", "mif1", "msf1"].includes(brand)) {
      return "image/heic";
    }
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return null;
}

export type UploadValidationFailure =
  | "too_large"
  | "mime_not_allowed"
  | "content_mismatch"
  | "empty";

export type ValidatedImage = {
  mimeType: string;
  extension: string;
};

/**
 * 校验上传图片：声明 MIME 必须在白名单内，且内容魔数与声明一致。
 * HEIC/HEIF 声明为 image/heic（嗅探不区分 heic/heif 子品牌，扩展名统一 heic）。
 */
export function validateImageUpload(
  buffer: Buffer,
  declaredMime: string,
): { ok: true; value: ValidatedImage } | { ok: false; error: UploadValidationFailure } {
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
