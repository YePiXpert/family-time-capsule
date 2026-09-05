import { describe, expect, it } from "vitest";
import { calendarRange } from "@/lib/memories/calendar-range";
import {
  addCalendarMonths,
  ageLocations,
  calendarAge,
  calendarDate,
  parseCalendarDate,
} from "@/mobile/src/utils/calendar";
import { formatAgeLabel } from "@/lib/memories/age";

describe("family calendar boundaries and anniversaries", () => {
  it.each([
    [
      "2026-01-01",
      "Asia/Shanghai",
      "2025-12-31T16:00:00.000Z",
      "2026-01-01T16:00:00.000Z",
    ],
    [
      "2026-03-08",
      "America/New_York",
      "2026-03-08T05:00:00.000Z",
      "2026-03-09T04:00:00.000Z",
    ],
    [
      "2026-11-01",
      "America/New_York",
      "2026-11-01T04:00:00.000Z",
      "2026-11-02T05:00:00.000Z",
    ],
    [
      "2024-02-29",
      "UTC",
      "2024-02-29T00:00:00.000Z",
      "2024-03-01T00:00:00.000Z",
    ],
    [
      "2026",
      "Asia/Shanghai",
      "2025-12-31T16:00:00.000Z",
      "2026-12-31T16:00:00.000Z",
    ],
  ])("%s in %s has an exact half-open interval", (key, zone, from, before) => {
    const range = calendarRange(key!, zone!);
    expect(range.from.toISOString()).toBe(from);
    expect(range.before.toISOString()).toBe(before);
  });
  it("uses calendar months rather than thirty days and never returns negative residual days", () => {
    expect(addCalendarMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addCalendarMonths("2024-02-29", 12)).toBe("2025-02-28");
    expect(calendarAge("2026-01-31", "2026-03-01")).toEqual({
      years: 0,
      months: 1,
      days: 1,
    });
    expect(
      formatAgeLabel("2026-08-10", new Date("2026-09-09T00:00:00Z"), "UTC"),
    ).toBe("第 30 天");
    expect(
      formatAgeLabel("2026-01-31", new Date("2026-02-28T12:00:00Z"), "UTC"),
    ).toBe("满月");
    expect(
      ageLocations("2024-02-29").find((a) => a.label === "周岁")?.date,
    ).toBe("2025-02-28");
  });
  it("does not consult the device timezone or fabricate invalid dates", () => {
    const before = process.env.TZ;
    process.env.TZ = "Pacific/Honolulu";
    try {
      expect(
        calendarDate(new Date("2025-12-31T16:30:00Z"), "Asia/Shanghai"),
      ).toBe("2026-01-01");
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
    expect(() => parseCalendarDate("2026-02-29")).toThrow("invalid_date");
    expect(() => calendarRange("2026-13", "UTC")).toThrow();
  });
});
