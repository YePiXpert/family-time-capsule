import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  embeddedTimeToUtc,
  extractEmbeddedTime,
  parseOffsetMinutes,
  zonedWallTimeToUtc,
} from "@/lib/metadata/time";

const fixtures = path.join(__dirname, "..", "fixtures");

describe("zonedWallTimeToUtc", () => {
  it("上海 2026-08-10 09:30 → UTC 01:30", () => {
    expect(zonedWallTimeToUtc("2026-08-10T09:30:00", "Asia/Shanghai").toISOString()).toBe(
      "2026-08-10T01:30:00.000Z",
    );
  });

  it("纽约（夏令时期间）2026-08-10 09:30 → UTC 13:30", () => {
    expect(zonedWallTimeToUtc("2026-08-10T09:30:00", "America/New_York").toISOString()).toBe(
      "2026-08-10T13:30:00.000Z",
    );
  });

  it("东京 2026-01-02 00:00 → UTC 前一天 15:00（跨日）", () => {
    expect(zonedWallTimeToUtc("2026-01-02T00:00:00", "Asia/Tokyo").toISOString()).toBe(
      "2026-01-01T15:00:00.000Z",
    );
  });
});

describe("parseOffsetMinutes", () => {
  it("解析 +08:00 / -05:30", () => {
    expect(parseOffsetMinutes("+08:00")).toBe(480);
    expect(parseOffsetMinutes("-05:30")).toBe(-330);
  });
  it("非法偏移返回 null", () => {
    expect(parseOffsetMinutes("0800")).toBeNull();
    expect(parseOffsetMinutes("+25:00")).toBeNull();
    expect(parseOffsetMinutes("+08:99")).toBeNull();
  });
});

describe("extractEmbeddedTime", () => {
  it("读取 DateTimeOriginal（无偏移）", async () => {
    const buffer = readFileSync(path.join(fixtures, "sample-exif.jpg"));
    const embedded = await extractEmbeddedTime(buffer);
    expect(embedded).not.toBeNull();
    expect(embedded!.wallTime).toBe("2026-08-10T09:30:00");
    expect(embedded!.offset).toBeNull();
    expect(embedded!.sourceTag).toBe("DateTimeOriginal");
    expect(embedded!.raw.DateTimeOriginal).toBe("2026:08:10 09:30:00");
  });

  it("读取 OffsetTimeOriginal", async () => {
    const buffer = readFileSync(path.join(fixtures, "sample-exif-offset.jpg"));
    const embedded = await extractEmbeddedTime(buffer);
    expect(embedded!.wallTime).toBe("2026-08-10T09:30:00");
    expect(embedded!.offset).toBe("+08:00");
  });

  it("无 EXIF 返回 null", async () => {
    const buffer = readFileSync(path.join(fixtures, "sample.jpg"));
    expect(await extractEmbeddedTime(buffer)).toBeNull();
  });

  it("HEIC（完整 HEIF 结构）可读出 DateTimeOriginal（v0.1.2 实证）", async () => {
    const buffer = readFileSync(path.join(fixtures, "sample-exif.heic"));
    const embedded = await extractEmbeddedTime(buffer);
    expect(embedded).not.toBeNull();
    expect(embedded!.wallTime).toBe("2026-08-15T09:00:00");
    expect(embedded!.offset).toBeNull();
    expect(embedded!.sourceTag).toBe("DateTimeOriginal");
  });

  it("无 EXIF 的 HEIC 仍优雅返回 null", async () => {
    const buffer = readFileSync(path.join(fixtures, "sample.heic"));
    expect(await extractEmbeddedTime(buffer)).toBeNull();
  });

  it("非图片字节返回 null 而不是抛错", async () => {
    expect(await extractEmbeddedTime(Buffer.alloc(64, 0x41))).toBeNull();
  });
});

describe("embeddedTimeToUtc", () => {
  it("显式 +08:00 偏移优先于家庭时区", () => {
    const utc = embeddedTimeToUtc(
      {
        wallTime: "2026-08-10T09:30:00",
        offset: "+08:00",
        raw: {},
        sourceTag: "DateTimeOriginal",
      },
      "America/New_York", // 家庭时区不同也不影响
    );
    expect(utc.toISOString()).toBe("2026-08-10T01:30:00.000Z");
  });

  it("显式 -05:00 偏移", () => {
    const utc = embeddedTimeToUtc(
      {
        wallTime: "2026-08-10T09:30:00",
        offset: "-05:00",
        raw: {},
        sourceTag: "DateTimeOriginal",
      },
      "Asia/Shanghai",
    );
    expect(utc.toISOString()).toBe("2026-08-10T14:30:00.000Z");
  });

  it("无偏移按家庭时区解释", () => {
    const utc = embeddedTimeToUtc(
      {
        wallTime: "2026-08-10T09:30:00",
        offset: null,
        raw: {},
        sourceTag: "DateTimeOriginal",
      },
      "Asia/Shanghai",
    );
    expect(utc.toISOString()).toBe("2026-08-10T01:30:00.000Z");
  });
});
