import { describe, expect, it } from "vitest";
import { emptyContent, type LocalRecord } from "../src/local/model";
import { searchRecords } from "../src/local/search";

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

it("故事筛选包含四主题，可与关键词和其他筛选叠加", () => {
  const stories = [
    record("birth", { story: "birth", text: "那天下雨", first: true }),
    record("pregnancy", { story: "pregnancy" }),
    record("name", { story: "name" }),
    record("met", { story: "met", text: "那天下雨" }),
    record("ordinary", { text: "那天下雨", first: true }),
  ];
  expect(searchRecords(stories, "", { story: true }).map((r) => r.id)).toEqual(["birth", "met", "name", "pregnancy"]);
  expect(searchRecords(stories, "下雨", { story: true, first: true }).map((r) => r.id)).toEqual(["birth"]);
  expect(searchRecords(stories, "", { story: false })).toHaveLength(5);
});
