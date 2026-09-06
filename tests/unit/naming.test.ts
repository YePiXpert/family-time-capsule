import { describe, expect, it } from "vitest";
import { readableName, sentenceTitle } from "@/lib/naming";

describe("shared readable names", () => {
  it("uses a reliable date in the family timezone, never import/file time", () => {
    const image = { mediaType: "image", originalFilename: "IMG_1234.jpg", capturedAt: "2026-09-05T18:00:00Z", timezone: "Asia/Shanghai" };
    expect(readableName(image).text).toBe("照片 · 2026年9月6日");
    expect(readableName({ ...image, capturedAt: null }).text).toBe("照片 · 时间待补充");
    for (const timeSource of ["import_time", "file_metadata"]) {
      expect(readableName({ ...image, timeSource }).text).toBe("照片 · 时间待补充");
    }
  });
  it("distinguishes a media display name, an original filename and a bundle title", () => {
    expect(readableName({ mediaType: "audio", durationMs: 35_900 }).text).toBe("一段录音 · 00:35");
    expect(readableName({ mediaType: "video" }).text).toBe("一段视频");
    expect(readableName({ mediaType: "document", originalFilename: "外婆的家书.pdf" }).text).toBe("外婆的家书.pdf");
    expect(readableName({ mediaType: "document", originalFilename: "外婆的家书.pdf", assetCount: 3 }).text).toBe("一组记忆素材 · 时间待补充");
  });
  it("protects legacy and human titles regardless of their filename pattern", () => {
    for (const source of [undefined, "legacy_unknown", "manual", "accepted_ai"]) {
      expect(readableName({ title: "IMG_1234", source, suggestion: { title: "花园里的花", valid: true, allowed: true, targetRevision: 0 } }).text).toBe("IMG_1234");
    }
  });
  it("requires permission, validity and the matching revision for marked AI display", () => {
    const input = { mediaType: "image", revision: 2, suggestion: { title: "窗边的积木", valid: true, allowed: true, targetRevision: 2 } };
    expect(readableName(input)).toMatchObject({ text: "窗边的积木", source: "ai_suggested", aiSuggested: true });
    for (const suggestion of [{ ...input.suggestion, valid: false }, { ...input.suggestion, allowed: false }, { ...input.suggestion, targetRevision: 1 }]) {
      expect(readableName({ ...input, suggestion }).text).toBe("照片 · 时间待补充");
    }
  });
  it("takes one bounded sentence without splitting supplementary Unicode characters", () => {
    expect(sentenceTitle(" 今天在公园玩。后来下雨了。\n全文仍保留")).toBe("今天在公园玩");
    expect(sentenceTitle("🌻".repeat(31))).toBe("🌻".repeat(30) + "…");
    expect(sentenceTitle("\u202e家人\u0000的声音")).toBe("家人的声音");
  });
});
