import { expect, it } from "vitest";
import { calendarMonthLabel, indexCalendarMonths } from "../src/utils/calendar-months";
const record = (id: string, occurredAt: string, occurredAtPrecision = "exact") => ({ id, occurredAt, occurredAtPrecision });
it("indexes the family's calendar month while keeping year-only and unknown anchors out of month counts", () => {
  const records = [record("edge", "2026-08-31T16:00:00Z"), record("month", "2026-08-31T16:00:00Z", "month"), record("day", "2026-08-31T15:59:00Z", "date_only"), record("year", "2026-01-01T00:00:00Z", "year"), record("unknown", "2026-09-12T00:00:00Z", "unknown"), record("broken", "invalid")];
  const index = indexCalendarMonths(records, "Asia/Shanghai");
  expect([...index.counts]).toEqual([["2026-09", 2], ["2026-08", 1]]);
  expect([...index.byId.keys()]).toEqual(["edge", "month", "day"]);
  expect(indexCalendarMonths(records, "UTC").counts.get("2026-08")).toBe(3);
  expect(calendarMonthLabel("2026-09")).toBe("2026 年 9 月");
});
