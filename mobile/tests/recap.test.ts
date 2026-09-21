import { describe, expect, it } from "vitest";
import { emptyContent, emptyLibrary, type LocalRecord } from "../src/local/model";
import { byCountsOf, byLine, recapOf } from "../src/local/recap";

const record = (id: string, date: string, extra: Partial<LocalRecord> = {}): LocalRecord => ({
  ...emptyContent(),
  id,
  revision: 1,
  updatedAt: date,
  title: `标题${id}`,
  text: id === "long" ? "很长的故事".repeat(10) : "短",
  date,
  ...extra,
});

describe("year recap", () => {
  it("sums months, covers, firsts and counters", () => {
    const library = emptyLibrary();
    for (const [id, kind] of [
      ["p1", "image"],
      ["p2", "image"],
      ["v1", "video"],
    ] as const)
      library.media[id] = {
        id,
        file: `${id}.bin`,
        name: id,
        kind,
        bytes: 1,
        sha256: "a".repeat(64),
      };
    const records = [
      record("a", "2026-01-15T10:00:00.000Z", {
        mediaIds: ["p1", "v1"],
        coverId: "p1",
      }),
      record("b", "2026-01-20T10:00:00.000Z", { first: true }),
      record("c", "2025-12-15T10:00:00.000Z", { mediaIds: ["p2"] }),
    ];
    const recap = recapOf(records, library.media);
    expect(recap.months.map((m) => `${m.month}:${m.count}`)).toEqual([
      "2026-01:2",
      "2025-12:1",
    ]);
    expect(recap.months[0]!.cover?.id).toBe("p1");
    expect(recap.months[1]!.cover?.id).toBe("p2");
    expect(recap.firsts.map((r) => r.id)).toEqual(["b"]);
    expect(recap.photos).toBe(2);
    expect(recap.av).toBe(1);
    expect(recap.chars).toBe(
      records.reduce((n, r) => n + r.title.length + r.text.length, 0),
    );
  });
  it("handles an empty year gracefully", () => {
    const recap = recapOf([], {});
    expect(recap.months).toEqual([]);
    expect(recap.firsts).toEqual([]);
    expect(recap.photos).toBe(0);
  });
});

describe("谁写了几段", () => {
  it("counts signatures, most first, ties by name, and renders one line", () => {
    const records = [
      record("a", "2026-01-01T00:00:00.000Z", { by: "妈妈" }),
      record("b", "2026-01-02T00:00:00.000Z", { by: "爸爸" }),
      record("c", "2026-01-03T00:00:00.000Z", { by: "妈妈" }),
      record("d", "2026-01-04T00:00:00.000Z"),
      record("e", "2026-01-05T00:00:00.000Z", { by: "外婆" }),
    ];
    const counts = byCountsOf(records);
    expect(counts).toEqual([
      { by: "妈妈", count: 2 },
      { by: "爸爸", count: 1 },
      { by: "外婆", count: 1 },
    ]);
    expect(byLine(counts)).toBe("妈妈写了 2 段 · 爸爸写了 1 段 · 外婆写了 1 段");
    expect(byLine([])).toBe("");
    expect(recapOf(records, {}).byCounts).toEqual(counts);
  });
});
