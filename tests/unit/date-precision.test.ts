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
