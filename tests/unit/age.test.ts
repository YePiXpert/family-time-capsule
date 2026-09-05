import { describe, expect, it } from "vitest";
import { calendarDiff, formatAgeLabel } from "@/lib/memories/age";

describe("formatAgeLabel / calendarDiff", () => {
  it("出生前", () => {
    expect(formatAgeLabel("2026-08-10", new Date("2026-08-01T12:00:00Z"), "UTC")).toBe(
      "出生前 9 天",
    );
  });

  it("出生当天", () => {
    expect(formatAgeLabel("2026-08-10", new Date("2026-08-10T23:00:00Z"), "UTC")).toBe(
      "出生当天",
    );
  });

  it("出生后第 N 天（跨日界）", () => {
    expect(formatAgeLabel("2026-08-10", new Date("2026-08-13T01:00:00Z"), "UTC")).toBe("第 3 天");
  });

  it("满月 / 百天", () => {
    expect(formatAgeLabel("2026-08-10", new Date("2026-09-10T00:00:00Z"), "UTC")).toBe("满月");
    expect(formatAgeLabel("2026-08-10", new Date("2026-11-18T00:00:00Z"), "UTC")).toBe("百天");
  });

  it("100 天以内用天数", () => {
    expect(formatAgeLabel("2026-08-10", new Date("2026-09-15T00:00:00Z"), "UTC")).toBe("第 36 天");
  });

  it("大于 100 天用年月", () => {
    expect(formatAgeLabel("2026-08-10", new Date("2026-12-25T00:00:00Z"), "UTC")).toBe("4 个月");
    expect(formatAgeLabel("2026-08-10", new Date("2027-08-10T00:00:00Z"), "UTC")).toBe("1 岁");
    expect(formatAgeLabel("2026-08-10", new Date("2027-10-15T00:00:00Z"), "UTC")).toBe(
      "1 岁 2 个月",
    );
  });

  it("calendarDiff 借位正确", () => {
    // 8/10 → 9/09：0 年 0 月 30 天（日不足借上个月真实天数）
    expect(calendarDiff("2026-08-10", new Date("2026-09-09T00:00:00Z"), "UTC")).toEqual({
      years: 0,
      months: 0,
      days: 30,
    });
    // 月末周年向目标月最后一天收敛：8/31 → 9/30 是一个日历月
    expect(calendarDiff("2026-08-31", new Date("2026-09-30T00:00:00Z"), "UTC")).toEqual({
      years: 0,
      months: 1,
      days: 0,
    });
  });

  it("无生日返回空串", () => {
    expect(formatAgeLabel(null, new Date(), "UTC")).toBe("");
    expect(formatAgeLabel(undefined, new Date(), "UTC")).toBe("");
  });

  it("按家庭日历日而不是 UTC 日界计算午夜附近年龄", () => {
    const instant = new Date("2026-08-09T16:30:00.000Z");
    expect(formatAgeLabel("2026-08-10", instant, "Asia/Shanghai")).toBe("出生当天");
    expect(formatAgeLabel("2026-08-10", instant, "America/New_York")).toBe("出生前 1 天");
  });
});
