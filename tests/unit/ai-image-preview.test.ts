import { createHash } from "node:crypto";
import sharp from "sharp";
import { expect, it } from "vitest";
import { AI_PREVIEW_LIMITS, createAiImagePreview } from "@/lib/ai/image-preview";

it("strips metadata and bounds dimensions without modifying original bytes", async () => {
  const original = await sharp({ create: { width: 3200, height: 2000, channels: 3, background: "red" } })
    .withExif({ IFD0: { Artist: "DO_NOT_SEND_PRIVATE_METADATA" } }).jpeg().toBuffer();
  const sha = () => createHash("sha256").update(original).digest("hex");
  const before = sha();
  expect((await sharp(original).metadata()).exif).toBeDefined();
  const preview = await createAiImagePreview(original);
  const metadata = await sharp(preview).metadata();
  expect(metadata.width).toBeLessThanOrEqual(AI_PREVIEW_LIMITS.edge);
  expect(metadata.height).toBeLessThanOrEqual(AI_PREVIEW_LIMITS.edge);
  expect(metadata.format).toBe("jpeg");
  expect(metadata.exif).toBeUndefined();
  expect(metadata.xmp).toBeUndefined();
  expect(Buffer.from(preview).includes(Buffer.from("DO_NOT_SEND_PRIVATE_METADATA"))).toBe(false);
  expect(preview.byteLength).toBeLessThanOrEqual(AI_PREVIEW_LIMITS.bytes);
  expect(sha()).toBe(before);
});

it("rejects unreadable image bytes before any provider invocation", async () => {
  await expect(createAiImagePreview(new TextEncoder().encode("not an image"))).rejects.toMatchObject({ code: "image_preview_unavailable", retryable: false });
});
