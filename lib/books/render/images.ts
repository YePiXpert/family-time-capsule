import sharp from "sharp";
import type { BookBlock } from "@/mobile/src/books/types";
import type { RenderInput } from "./types";
/** Layout-sized derivatives always read original files. Never enlarge a thumbnail. */
export async function renderBookImage(
  input: RenderInput,
  assetId: string,
  width: number,
  height: number,
  block?: BookBlock,
  slot = 0,
): Promise<Buffer> {
  const source = input.images[assetId];
  if (!source || source.bytes > 128 * 1024 * 1024)
    throw new Error("image_source_unavailable");
  let pipeline = sharp(source.path, {
    limitInputPixels: 64_000_000,
    failOn: "error",
  })
    .rotate()
    .timeout({ seconds: 30 });
  if (block?.layout.fit === "cover") {
    const meta = await sharp(source.path, {
      limitInputPixels: 64_000_000,
    }).metadata();
    const rotated = [5, 6, 7, 8].includes(meta.orientation ?? 1),
      w = (rotated ? meta.height : meta.width)!,
      h = (rotated ? meta.width : meta.height)!;
    const ratio = width / height,
      focus = block.layout.focus[slot] ?? { x: 0.5, y: 0.5 },
      cropW = Math.min(w, Math.round(h * ratio)),
      cropH = Math.min(h, Math.round(w / ratio));
    pipeline = pipeline.extract({
      left: Math.max(
        0,
        Math.min(w - cropW, Math.round(focus.x * w - cropW / 2)),
      ),
      top: Math.max(
        0,
        Math.min(h - cropH, Math.round(focus.y * h - cropH / 2)),
      ),
      width: Math.max(1, cropW),
      height: Math.max(1, cropH),
    });
  }
  const result = await pipeline
    .resize({
      width: Math.ceil(width),
      height: Math.ceil(height),
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90 })
    .toBuffer();
  if (result.length > 16 * 1024 * 1024)
    throw new Error("image_output_too_large");
  return result;
}
