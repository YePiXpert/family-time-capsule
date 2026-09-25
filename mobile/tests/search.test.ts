import { describe, expect, it } from "vitest";
import { emptyContent, freezeEntity, sortedRecords, type LocalRecord } from "../src/local/model";
import { SEARCH_LIMIT, searchRecords, searchSortedRecords } from "../src/local/search";

const record = (
  id: string,
  fields: Partial<LocalRecord> & { date?: string } = {},
): LocalRecord => ({
  ...emptyContent(),
  id,
  revision: 1,
  updatedAt: fields.date ?? "2026-09-01T10:00:00.000Z",
  title: "",
  text: "",
  date: "2026-09-01T10:00:00.000Z",
  ...fields,
});

describe("global search", () => {
  const records = [
    record("a", {
      title: "第一次挥手",
      text: "她在餐椅上朝我们挥手。",
      location: "家里",
      date: "2026-09-01T10:00:00.000Z",
    }),
    record("b", {
      title: "公园的下午",
      text: "走了很远，WALKED a lot。",
      date: "2025-08-15T10:00:00.000Z",
      first: true,
      mediaIds: ["m1"],
    }),
    record("c", {
      title: "一段录音",
      text: "她哼的歌。",
      date: "2026-01-10T10:00:00.000Z",
      mediaIds: ["m2"],
    }),
  ];
  const kinds = { m1: "image", m2: "audio" };

  it("matches title, body and location case-insensitively across CJK and ASCII", () => {
    expect(searchRecords(records, "挥手", {}, kinds).map((r) => r.id)).toEqual([
      "a",
    ]);
    expect(searchRecords(records, "walked", {}, kinds).map((r) => r.id)).toEqual([
      "b",
    ]);
    expect(searchRecords(records, "家里", {}, kinds).map((r) => r.id)).toEqual([
      "a",
    ]);
  });
  it("combines filters and sorts by date descending", () => {
    expect(
      searchRecords(records, "", { first: true }, kinds).map((r) => r.id),
    ).toEqual(["b"]);
    expect(
      searchRecords(records, "", { media: "av" }, kinds).map((r) => r.id),
    ).toEqual(["c"]);
    expect(
      searchRecords(records, "", { media: "none" }, kinds).map((r) => r.id),
    ).toEqual(["a"]);
    expect(
      searchRecords(records, "", { year: "2026" }, kinds).map((r) => r.id),
    ).toEqual(["a", "c"]);
    expect(searchRecords(records, "", {}, kinds).map((r) => r.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });
  it("filters her own words", () => {
    const quoted = [
      record("q", { text: "妈妈，月亮跟着我走。", quote: true, date: "2026-09-02T10:00:00.000Z" }),
      ...records,
    ];
    expect(searchRecords(quoted, "", { quote: true }).map((r) => r.id)).toEqual(["q"]);
    expect(searchRecords(quoted, "月亮", {}).map((r) => r.id)).toEqual(["q"]);
    expect(searchRecords(quoted, "", { quote: true, first: true })).toEqual([]);
  });
  it("caps results at 100", () => {
    const many = Array.from({ length: 130 }, (_, i) =>
      record(`r${i}`, { date: `2026-01-01T${String(i % 24).padStart(2, "0")}:00:00.000Z` }),
    );
    expect(searchRecords(many, "", {}, {})).toHaveLength(100);
  });
});

describe("落款筛选", () => {
  const signed = [
    record("d", { text: "爸爸记的", by: "爸爸", date: "2026-09-03T10:00:00.000Z" }),
    record("m", { text: "妈妈记的", by: "妈妈", date: "2026-09-02T10:00:00.000Z" }),
    record("n", { text: "没落款", date: "2026-09-01T10:00:00.000Z" }),
  ];
  it("keeps only records signed by that person and stacks with the other filters", () => {
    expect(searchRecords(signed, "", { by: "爸爸" }).map((r) => r.id)).toEqual(["d"]);
    expect(searchRecords(signed, "记的", { by: "妈妈" }).map((r) => r.id)).toEqual(["m"]);
    expect(searchRecords(signed, "", { by: "外婆" })).toEqual([]);
    expect(searchRecords(signed, "").map((r) => r.id)).toEqual(["d", "m", "n"]);
  });
});

it("默认最多列 100 段，调用方可多取一条判断还有更早的", () => {
  const many = Array.from({ length: 105 }, (_, i) => ({
    id: `m${String(i).padStart(3, "0")}`,
    title: "",
    text: "散步",
    location: "",
    date: `2020-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
    first: false,
    mediaIds: [],
    coverId: null,
    revision: 1,
    updatedAt: "2020-01-01T00:00:00.000Z",
  }));
  expect(searchRecords(many, "散步")).toHaveLength(SEARCH_LIMIT);
  expect(searchRecords(many, "散步", {}, {}, SEARCH_LIMIT + 1)).toHaveLength(SEARCH_LIMIT + 1);
});

it("搜索页走缓存的排序：结果与逐次排序的全库搜索一致，够数就停", () => {
  const many = Array.from({ length: 300 }, (_, i) =>
    freezeEntity(
      record(`r${String(i).padStart(3, "0")}`, {
        date: new Date(Date.UTC(2026, 0, 1 + (i % 40), i % 24)).toISOString(),
        text: i % 3 ? "去公园散步" : "在家里",
        first: i % 7 === 0,
        by: i % 2 ? "爸爸" : "妈妈",
      }),
    ),
  );
  const map = Object.freeze(Object.fromEntries(many.map((r) => [r.id, r])));
  const sorted = sortedRecords({ records: map });
  expect(sortedRecords({ records: map })).toBe(sorted);
  for (const [query, filters, limit] of [
    ["", {}, SEARCH_LIMIT],
    ["散步", {}, SEARCH_LIMIT + 1],
    ["家里", { first: true }, SEARCH_LIMIT],
    ["", { by: "爸爸", year: "2026" }, 5],
    ["没有这句", {}, SEARCH_LIMIT],
  ] as const)
    expect(searchSortedRecords(sorted, query, filters, {}, limit)).toEqual(
      searchRecords([...many].reverse(), query, filters, {}, limit),
    );
});
