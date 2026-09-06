import "server-only";
import sharp from "sharp";
import { AiJobHandlerError } from "@/jobs/types";

export const AI_PREVIEW_LIMITS = Object.freeze({ edge: 1600, bytes: 2 * 1024 * 1024, pixels: 40_000_000 });

/** In-memory, first-frame JPEG. Sharp strips EXIF/XMP/ICC unless explicitly kept.
 * The original stays at its existing storage key and is never written here. */
export async function createAiImagePreview(input: Uint8Array): Promise<Uint8Array> {
  try {
    const output = await sharp(input, { limitInputPixels: AI_PREVIEW_LIMITS.pixels, animated: false, failOn: "error" })
      .rotate()
      .resize({ width: AI_PREVIEW_LIMITS.edge, height: AI_PREVIEW_LIMITS.edge, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "white" })
      .jpeg({ quality: 78 })
      .toBuffer();
    if (output.byteLength > AI_PREVIEW_LIMITS.bytes) throw new AiJobHandlerError("image_preview_too_large", false);
    return new Uint8Array(output);
  } catch (error) {
    if (error instanceof AiJobHandlerError) throw error;
    throw new AiJobHandlerError("image_preview_unavailable", false);
  }
}
