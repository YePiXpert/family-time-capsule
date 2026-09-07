import { describe, expect, it } from "vitest";
import {
  formatOccurredLabel,
  isOccurredAtPrecision,
  precisionHasDay,
  precisionSupportsDateFilter,
  anchorFromPrecisionInput,
} from "@/lib/metadata/precision";
import { zonedWallTimeToUtc } from "@/lib/metadata/time";

describe("§6 日期精度纯函数", () => {
  it("显示不泄露虚假精度", () => {
    const utc = "2020-05-03T16:00:00.000Z"; // 上海 2020-05-04 00:00
    expect(formatOccurredLabel("exact", utc, "Asia/Shanghai")).toBe("2020年5月4日 00:00");
    expect(formatOccurredLabel("approximate", utc, "Asia/Shanghai")).toBe("大约 2020年5月4日");
    expect(formatOccurredLabel("date_only", utc, "Asia/Shanghai")).toBe("2020年5月4日");
    expect(formatOccurredLabel("month", utc, "Asia/Shanghai")).toBe("2020年5月");
    expect(formatOccurredLabel("year", utc, "Asia/Shanghai")).toBe("2020年");
    expect(formatOccurredLabel("unknown", utc, "Asia/Shanghai")).toBe("时间不确定");
  });

  it("跨年与跨月边界按家庭时区归属", () => {
    // 上海 2026-01-01 04:00 = UTC 2025-12-31T20:00：年份必须按家庭时区显示
    expect(formatOccurredLabel("year", "2025-12-31T20:00:00.000Z", "Asia/Shanghai")).toBe("2026年");
    expect(formatOccurredLabel("month", "2025-12-31T20:00:00.000Z", "Asia/Shanghai")).toBe("2026年1月");
  });

  it("精度决定日历/年龄/筛选语义", () => {
    expect(precisionHasDay("date_only")).toBe(true);
    expect(precisionHasDay("month")).toBe(false);
    expect(precisionHasDay("unknown")).toBe(false);
    expect(precisionSupportsDateFilter("month")).toBe(true);
    expect(precisionSupportsDateFilter("unknown")).toBe(false);
    expect(isOccurredAtPrecision("month")).toBe(true);
    expect(isOccurredAtPrecision("season")).toBe(false);
  });

  it("锚点换算：年月取该期首日，unknown 无锚点", () => {
    const toUtc = (wall: string, tz: string) => zonedWallTimeToUtc(wall, tz);
    const monthAnchor = anchorFromPrecisionInput({ precision: "month", wall: "1988-05", timezone: "Asia/Shanghai", toUtc });
    expect(monthAnchor?.toISOString()).toBe(zonedWallTimeToUtc("1988-05-01T00:00:00", "Asia/Shanghai").toISOString());
    const yearAnchor = anchorFromPrecisionInput({ precision: "year", wall: "1988", timezone: "Asia/Shanghai", toUtc });
    expect(yearAnchor?.toISOString()).toBe(zonedWallTimeToUtc("1988-01-01T00:00:00", "Asia/Shanghai").toISOString());
    expect(anchorFromPrecisionInput({ precision: "unknown", wall: "", timezone: "Asia/Shanghai", toUtc })).toBeNull();
    expect(anchorFromPrecisionInput({ precision: "month", wall: "not-a-month", timezone: "Asia/Shanghai", toUtc })).toBeNull();
  });
});

describe("§6 DST 与跨年专项", () => {
  it("DST 时区的月/年锚点按该期首日的当时偏移换算", () => {
    const toUtc = zonedWallTimeToUtc;
    // 纽约 1988-07-01 处于 EDT（UTC-4）；1988-01-01 处于 EST（UTC-5）
    expect(anchorFromPrecisionInput({ precision: "month", wall: "1988-07", timezone: "America/New_York", toUtc })?.toISOString()).toBe("1988-07-01T04:00:00.000Z");
    expect(anchorFromPrecisionInput({ precision: "year", wall: "1988", timezone: "America/New_York", toUtc })?.toISOString()).toBe("1988-01-01T05:00:00.000Z");
  });

  it("DST 秋季回拨日的墙钟照实显示，月锚点往返不漂移", () => {
    // 2026-11-01 01:30 是纽约秋季回拨的重复小时；换算取较早时刻（EDT）
    const anchor = zonedWallTimeToUtc("2026-11-01T01:30:00", "America/New_York");
    expect(anchor.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(formatOccurredLabel("exact", anchor, "America/New_York")).toBe("2026年11月1日 01:30");
    const monthAnchor = anchorFromPrecisionInput({ precision: "month", wall: "2026-11", timezone: "America/New_York", toUtc: zonedWallTimeToUtc })!;
    expect(formatOccurredLabel("month", monthAnchor, "America/New_York")).toBe("2026年11月");
  });

  it("跨年排序与显示：12月月锚点排在次年1月之前，家庭时区归属不漂移", () => {
    const toUtc = zonedWallTimeToUtc;
    const december = anchorFromPrecisionInput({ precision: "month", wall: "2025-12", timezone: "Asia/Shanghai", toUtc })!;
    const january = anchorFromPrecisionInput({ precision: "date_only", wall: "2026-01-05", timezone: "Asia/Shanghai", toUtc })!;
    expect(december.getTime()).toBeLessThan(january.getTime());
    // 上海 2025-12-01 00:00 = UTC 2025-11-30T16:00：UTC 上年末不漂成次年
    expect(december.toISOString()).toBe("2025-11-30T16:00:00.000Z");
    expect(formatOccurredLabel("month", december, "Asia/Shanghai")).toBe("2025年12月");
    expect(formatOccurredLabel("date_only", january, "Asia/Shanghai")).toBe("2026年1月5日");
  });
});
