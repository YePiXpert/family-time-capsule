import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_BYTES,
  parseImageSize,
  sniffImageMime,
  validateImageUpload,
} from "@/lib/assets/validation";

function pngWithDimensions(width: number, height: number): Buffer {
  // 最小合法 PNG 头 + IHDR（尺寸字段在大端 16/20 偏移）
  const buf = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(buf, 0);
  buf.writeUInt32BE(13, 8); // IHDR length
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

describe("sniffImageMime 魔数嗅探", () => {
  it("识别 PNG / JPEG / GIF / WebP", () => {
    expect(sniffImageMime(pngWithDimensions(3, 4))).toBe("image/png");
    const jpeg = Buffer.alloc(16);
    Buffer.from("ffd8ffe0", "hex").copy(jpeg, 0);
    expect(sniffImageMime(jpeg)).toBe("image/jpeg");
    const gif = Buffer.alloc(16);
    gif.write("GIF89a", 0, "ascii");
    expect(sniffImageMime(gif)).toBe("image/gif");
    const webp = Buffer.alloc(16);
    webp.write("RIFF", 0, "ascii");
    webp.writeUInt32LE(0, 4);
    webp.write("WEBP", 8, "ascii");
    expect(sniffImageMime(webp)).toBe("image/webp");
  });

  it("非图片内容返回 null", () => {
    expect(sniffImageMime(Buffer.from("MZ\x90\x00 not an image at all.."))).toBeNull();
    expect(sniffImageMime(Buffer.alloc(8))).toBeNull();
  });
});

describe("validateImageUpload", () => {
  const png = pngWithDimensions(3, 4);

  it("合法 PNG 通过并返回 jpg/png 扩展映射", () => {
    const result = validateImageUpload(png, "image/png");
    expect(result).toEqual({
      ok: true,
      value: { mimeType: "image/png", extension: "png" },
    });
  });

  it("声明 MIME 不在白名单被拒绝", () => {
    const result = validateImageUpload(png, "application/octet-stream");
    expect(result).toEqual({ ok: false, error: "mime_not_allowed" });
  });

  it("伪装扩展（exe 改名 jpg）内容不匹配被拒绝", () => {
    const exe = Buffer.concat([
      Buffer.from("MZ\x90\x00"),
      Buffer.alloc(64, 0x41),
    ]);
    const result = validateImageUpload(exe, "image/jpeg");
    expect(result).toEqual({ ok: false, error: "content_mismatch" });
  });

  it("PNG 声明成 JPEG 被拒绝（内容不匹配）", () => {
    const result = validateImageUpload(png, "image/jpeg");
    expect(result).toEqual({ ok: false, error: "content_mismatch" });
  });

  it("超过大小限制被拒绝", () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    Buffer.from("89504e470d0a1a0a", "hex").copy(big, 0);
    const result = validateImageUpload(big, "image/png");
    expect(result).toEqual({ ok: false, error: "too_large" });
  });

  it("空文件被拒绝", () => {
    expect(validateImageUpload(Buffer.alloc(0), "image/png")).toEqual({
      ok: false,
      error: "empty",
    });
  });

  it("MIME 带参数（image/jpeg; charset=binary）按基础类型处理", () => {
    const jpeg = Buffer.alloc(16);
    Buffer.from("ffd8ffe0", "hex").copy(jpeg, 0);
    const result = validateImageUpload(jpeg, "image/jpeg; charset=binary");
    expect(result.ok).toBe(true);
  });
});

describe("parseImageSize", () => {
  it("PNG 尺寸", () => {
    expect(parseImageSize(pngWithDimensions(1920, 1080), "image/png")).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("真实 JPEG 文件尺寸（测试夹具）", () => {
    const file = readFileSync(
      path.join(__dirname, "..", "fixtures", "sample.jpg"),
    );
    const dims = parseImageSize(file, "image/jpeg");
    expect(dims).toEqual({ width: 4, height: 4 });
  });

  it("未知类型返回 null", () => {
    expect(parseImageSize(Buffer.alloc(32), "image/heic")).toBeNull();
  });
});
