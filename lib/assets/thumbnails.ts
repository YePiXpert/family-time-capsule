import sharp from "sharp";

/**
 * 图片缩略图衍生物（PRD §11/§21「衍生预览独立保存」，v0.1.3）。
 *
 * - 640px 内缩放、遵循 EXIF 方向（rotate()）、WebP 输出；
 * - sharp 不支持的输入（预构建 libvips 无 HEIF 解码）→ 返回 null，
 *   上传主流程不受影响，UI 沿用「原件已安全保存」占位；
 * - 缩略图只是衍生物：原件永不改动，可随时删除重建。
 */

export const THUMBNAIL_MAX = 640;

export async function generateThumbnail(buffer: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(buffer, { failOn: "none" })
      .rotate()
      .resize(THUMBNAIL_MAX, THUMBNAIL_MAX, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}
