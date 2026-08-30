import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_AUDIO_BYTES,
  MAX_VIDEO_BYTES,
  sniffAudioMime,
  sniffImageMime,
  sniffVideoMime,
  validateImageUpload,
  validateMediaUpload,
} from "@/lib/assets/validation";

const fixtures = path.join(__dirname, "..", "fixtures");

function mp3Frame(): Buffer {
  // MPEG1 Layer3 帧头 FF FB 90 00 + 数据
  return Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(64, 0x11)]);
}

describe("sniffAudioMime", () => {
  it("识别 WAV / MP3(ID3) / MP3(帧同步) / OGG / FLAC", () => {
    const wav = readFileSync(path.join(fixtures, "sample.wav"));
    expect(sniffAudioMime(wav)).toBe("audio/wav");
    expect(sniffAudioMime(Buffer.concat([Buffer.from("ID3\x04\x00"), Buffer.alloc(32)]))).toBe(
      "audio/mpeg",
    );
    expect(sniffAudioMime(mp3Frame())).toBe("audio/mpeg");
    expect(
      sniffAudioMime(Buffer.concat([Buffer.from("OggS"), Buffer.alloc(32)])),
    ).toBe("audio/ogg");
    expect(
      sniffAudioMime(Buffer.concat([Buffer.from("fLaC"), Buffer.alloc(32)])),
    ).toBe("audio/flac");
  });

  it("非音频返回 null", () => {
    expect(sniffAudioMime(Buffer.alloc(64, 0x41))).toBeNull();
    expect(sniffAudioMime(readFileSync(path.join(fixtures, "sample.jpg")))).toBeNull();
  });
});

describe("sniffVideoMime", () => {
  it("识别 MP4 / MOV", () => {
    const mp4 = readFileSync(path.join(fixtures, "sample.mp4"));
    expect(sniffVideoMime(mp4)).toBe("video/mp4");
    const mov = Buffer.alloc(16);
    mov.writeUInt32BE(16, 0);
    mov.write("ftyp", 4, "ascii");
    mov.write("qt  ", 8, "ascii");
    expect(sniffVideoMime(mov)).toBe("video/quicktime");
  });

  it("非视频返回 null", () => {
    expect(sniffVideoMime(readFileSync(path.join(fixtures, "sample.wav")))).toBeNull();
  });
});

describe("sniffImageMime（RH-001 真实容器样本）", () => {
  it("识别 HEIC / HEIF 品牌", () => {
    expect(sniffImageMime(readFileSync(path.join(fixtures, "sample.heic")))).toBe("image/heic");
    expect(sniffImageMime(readFileSync(path.join(fixtures, "sample.heif")))).toBe("image/heif");
  });

  it("识别真实 PNG", () => {
    expect(sniffImageMime(readFileSync(path.join(fixtures, "sample.png")))).toBe("image/png");
  });
});

describe("validateImageUpload（HEIC 家族）", () => {
  it("声明 image/heic + heic 内容通过", () => {
    const buf = readFileSync(path.join(fixtures, "sample.heic"));
    expect(validateImageUpload(buf, "image/heic")).toEqual({
      ok: true,
      value: { mimeType: "image/heic", extension: "heic" },
    });
  });

  it("声明 image/heif + mif1 内容通过（同族）", () => {
    const buf = readFileSync(path.join(fixtures, "sample.heif"));
    expect(validateImageUpload(buf, "image/heif")).toEqual({
      ok: true,
      value: { mimeType: "image/heif", extension: "heif" },
    });
    // 声明 heic、内容 heif 也放行（同族互换）
    expect(validateImageUpload(buf, "image/heic").ok).toBe(true);
  });

  it("HEIC 内容声明成 PNG 被拒绝（跨族）", () => {
    const buf = readFileSync(path.join(fixtures, "sample.heic"));
    expect(validateImageUpload(buf, "image/png")).toEqual({
      ok: false,
      error: "content_mismatch",
    });
  });
});

describe("sniffAudioMime / sniffVideoMime（RH-001 真实容器样本）", () => {
  it("识别 M4A / MP3(ID3)", () => {
    expect(sniffAudioMime(readFileSync(path.join(fixtures, "sample.m4a")))).toBe("audio/mp4");
    expect(sniffAudioMime(readFileSync(path.join(fixtures, "sample.mp3")))).toBe("audio/mpeg");
  });

  it("识别 MOV（qt 品牌）/ MP4", () => {
    expect(sniffVideoMime(readFileSync(path.join(fixtures, "sample.mov")))).toBe("video/quicktime");
    expect(sniffVideoMime(readFileSync(path.join(fixtures, "sample.mp4")))).toBe("video/mp4");
  });

  it("MOV 声明 video/quicktime 通过；伪装成音频被拒绝", () => {
    const mov = readFileSync(path.join(fixtures, "sample.mov"));
    expect(validateMediaUpload(mov, "video/quicktime", "video")).toEqual({
      ok: true,
      value: { mimeType: "video/quicktime", extension: "mov" },
    });
    expect(validateMediaUpload(mov, "audio/m4a", "audio")).toEqual({
      ok: false,
      error: "content_mismatch",
    });
  });

  it("M4A 家族（m4a/x-m4a/mp4 声明）全部通过", () => {
    const m4a = readFileSync(path.join(fixtures, "sample.m4a"));
    for (const declared of ["audio/m4a", "audio/x-m4a", "audio/mp4"]) {
      expect(validateMediaUpload(m4a, declared, "audio").ok, declared).toBe(true);
    }
  });
});

describe("validateMediaUpload", () => {
  const wav = readFileSync(path.join(fixtures, "sample.wav"));
  const mp4 = readFileSync(path.join(fixtures, "sample.mp4"));

  it("合法 WAV 通过（audio/wav 声明）", () => {
    expect(validateMediaUpload(wav, "audio/wav", "audio")).toEqual({
      ok: true,
      value: { mimeType: "audio/wav", extension: "wav" },
    });
  });

  it("m4a 家族别名通过", () => {
    const m4a = Buffer.alloc(20);
    m4a.writeUInt32BE(20, 0);
    m4a.write("ftyp", 4, "ascii");
    m4a.write("M4A ", 8, "ascii");
    expect(validateMediaUpload(m4a, "audio/x-m4a", "audio")).toEqual({
      ok: true,
      value: { mimeType: "audio/x-m4a", extension: "m4a" },
    });
  });

  it("合法 MP4 通过", () => {
    expect(validateMediaUpload(mp4, "video/mp4", "video")).toEqual({
      ok: true,
      value: { mimeType: "video/mp4", extension: "mp4" },
    });
  });

  it("声明族与内容不符被拒绝（wav 声明成 video/mp4）", () => {
    expect(validateMediaUpload(wav, "video/mp4", "video")).toEqual({
      ok: false,
      error: "content_mismatch",
    });
    expect(validateMediaUpload(mp4, "audio/mpeg", "audio")).toEqual({
      ok: false,
      error: "content_mismatch",
    });
  });

  it("exe 伪装音频被拒绝（嗅探不出内容）", () => {
    const exe = Buffer.concat([Buffer.from("MZ\x90\x00"), Buffer.alloc(64, 0x41)]);
    expect(validateMediaUpload(exe, "audio/mpeg", "audio")).toEqual({
      ok: false,
      error: "content_mismatch",
    });
  });

  it("白名单外 MIME 被拒绝", () => {
    expect(validateMediaUpload(wav, "application/zip", "audio")).toEqual({
      ok: false,
      error: "mime_not_allowed",
    });
  });

  it("超过大小限制被拒绝", () => {
    const bigWav = Buffer.concat([wav, Buffer.alloc(MAX_AUDIO_BYTES)]);
    expect(validateMediaUpload(bigWav, "audio/wav", "audio")).toEqual({
      ok: false,
      error: "too_large",
    });
    const bigMp4 = Buffer.concat([mp4, Buffer.alloc(MAX_VIDEO_BYTES)]);
    expect(validateMediaUpload(bigMp4, "video/mp4", "video")).toEqual({
      ok: false,
      error: "too_large",
    });
  });

  it("image 校验不受 media 校验改动影响（回归）", () => {
    const png = readFileSync(path.join(fixtures, "sample.jpg"));
    expect(validateImageUpload(png, "image/jpeg").ok).toBe(true);
  });
});
