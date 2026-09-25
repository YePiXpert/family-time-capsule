import { describe, expect, it } from "vitest";
import { heroItems, shelfIndex, shelfTiles } from "../src/local/shelf-plan";
import { monthKey, yearKey } from "../src/local/model";

const none = { firsts: 0, quotes: 0, albumIds: [], letterIds: [] };

describe("shelfTiles", () => {
  it("puts each year's volume before its months, newest first", () => {
    const { time, topics } = shelfTiles({
      ...none,
      months: ["2026-09"],
      years: ["2026"],
    });
    expect(time).toEqual([
      { kind: "year", year: "2026" },
      { kind: "month", month: "2026-09" },
    ]);
    expect(topics).toEqual([]);
  });

  it("groups the six most recent months by year and keeps older years as volumes only", () => {
    const { time } = shelfTiles({
      ...none,
      months: ["2027-02", "2027-01", "2026-12", "2026-11", "2026-10", "2026-09", "2026-08", "2025-01"],
      years: ["2027", "2026", "2025"],
    });
    expect(time).toEqual([
      { kind: "year", year: "2027" },
      { kind: "month", month: "2027-02" },
      { kind: "month", month: "2027-01" },
      { kind: "year", year: "2026" },
      { kind: "month", month: "2026-12" },
      { kind: "month", month: "2026-11" },
      { kind: "month", month: "2026-10" },
      { kind: "month", month: "2026-09" },
      { kind: "year", year: "2025" },
    ]);
  });

  it("lists collections, albums and letters after the time volumes, in the given order", () => {
    const { topics } = shelfTiles({
      months: ["2026-09"],
      years: ["2026"],
      firsts: 2,
      quotes: 1,
      albumIds: ["a2", "a1"],
      letterIds: ["draft", "sealed"],
    });
    expect(topics).toEqual([
      { kind: "firsts" },
      { kind: "quotes" },
      { kind: "album", id: "a2" },
      { kind: "album", id: "a1" },
      { kind: "letter", id: "draft" },
      { kind: "letter", id: "sealed" },
    ]);
  });

  it("is empty for an empty library but still shows letters", () => {
    expect(shelfTiles({ ...none, months: [], years: [], letterIds: ["l"] })).toEqual({
      time: [],
      topics: [{ kind: "letter", id: "l" }],
    });
  });
});

describe("heroItems", () => {
  const record = (id: string, date: string) => ({ id, date });
  const today = new Date(2027, 8, 2, 9, 0);

  it("puts this day in earlier years first, then the ten most recent without repeats", () => {
    const records = [
      record("new", new Date(2027, 8, 1).toISOString()),
      record("lastYear", new Date(2026, 8, 2, 20, 0).toISOString()),
      record("older", new Date(2026, 7, 1).toISOString()),
      record("twoYears", new Date(2025, 8, 2, 8, 0).toISOString()),
    ];
    expect(heroItems(records, today)).toEqual([
      { record: records[1], yearsAgo: 1 },
      { record: records[3], yearsAgo: 2 },
      { record: records[0] },
      { record: records[2] },
    ]);
  });

  it("does not treat today's own records as an anniversary and caps the recent list", () => {
    const records = Array.from({ length: 14 }, (_, i) =>
      record(`r${i}`, new Date(2027, 8, 2 - i).toISOString()),
    );
    const items = heroItems(records, today);
    expect(items.every((item) => item.yearsAgo === undefined)).toBe(true);
    expect(items.map((item) => item.record.id)).toEqual(
      records.slice(0, 10).map((r) => r.id),
    );
  });
});

describe("shelfIndex", () => {
  it("matches the per-render passes it replaced: months, years, counts and month buckets", () => {
    const records = [
      { id: "a", date: "2026-09-20T10:00:00.000Z", first: true, quote: false },
      { id: "b", date: "2026-09-01T10:00:00.000Z", first: false, quote: true },
      { id: "c", date: "2026-08-31T10:00:00.000Z", first: false, quote: false },
      { id: "d", date: "2025-12-31T10:00:00.000Z", first: true, quote: true },
    ];
    const index = shelfIndex(records);
    expect(index.months).toEqual([...new Set(records.map((r) => monthKey(r.date)))]);
    expect(index.years).toEqual([...new Set(records.map((r) => yearKey(r.date)))]);
    expect(index.firsts).toBe(2);
    expect(index.quotes).toBe(2);
    for (const month of index.months)
      expect(index.byMonth.get(month)).toEqual(records.filter((r) => monthKey(r.date) === month));
    expect(shelfIndex([]).months).toEqual([]);
  });
});
