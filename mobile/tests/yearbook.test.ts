import { describe, expect, it } from "vitest";
import {
  MONTH_COLUMNS,
  YEARBOOK_MAX_FIRSTS,
  YEARBOOK_MAX_HEIGHT,
  YEARBOOK_WIDTH,
  layoutYearbook,
  yearBookInput,
  type YearBookSource,
  type YearbookInput,
} from "../src/local/yearbook";

const months = (n: number, withPhoto: number[]) =>
  Array.from({ length: n }, (_, i) => ({
    label: `2026年${i + 1}月`,
    count: i % 3,
    ...(withPhoto.includes(i) ? { photoAspect: 4 / 3 } : {}),
  }));

function input(overrides: Partial<YearbookInput> = {}): YearbookInput {
  return {
    year: "2026",
    profileName: "桉桉",
    stats: "12 段时光 · 20 张照片",
    note: "",
    months: [],
    firsts: [],
    colophon: "2026 年",
    ...overrides,
  };
}

describe("yearbook sheet layout", () => {
  it("keeps the sheet printable when the year is empty", () => {
    const layout = layoutYearbook(input());
    expect(layout.width).toBe(YEARBOOK_WIDTH);
    expect(layout.height).toBeGreaterThanOrEqual(1000);
    expect(layout.cells).toEqual([]);
    expect(layout.noteLines).toEqual([]);
    expect(layout.coverPhoto).toBeNull();
    expect(layout.firstsHeadingY).toBeNull();
  });
  it("lays the twelve months into a fixed grid with labels and counts", () => {
    const layout = layoutYearbook(
      input({ months: months(12, [0, 5, 11]) }),
    );
    expect(layout.cells).toHaveLength(12);
    expect(MONTH_COLUMNS).toBe(4);
    const first = layout.cells[0]!,
      second = layout.cells[1]!,
      fifth = layout.cells[4]!;
    // 同一行共享 y，行与行之间只差一个固定行高。
    expect(second.y).toBe(first.y);
    expect(second.x).toBeGreaterThan(first.x);
    expect(fifth.y).toBeGreaterThan(first.y);
    // 缺照片的月份不影响其它格的几何。
    expect(layout.cells[1]!.hasPhoto).toBe(false);
    expect(layout.cells[0]!.hasPhoto).toBe(true);
    expect(layout.cells[1]!.w).toBe(first.w);
    expect(layout.cells[11]!.label).toBe("2026年12月");
    expect(layout.cells[4]!.countY).toBeGreaterThan(layout.cells[4]!.labelY);
  });
  it("grows with the note, clamps the cover and lists firsts in order", () => {
    const bare = layoutYearbook(input({ months: months(12, [0]) }));
    const rich = layoutYearbook(
      input({
        months: months(12, [0]),
        note: "这一年你学会了走路。".repeat(6),
        coverAspect: 4 / 3,
        firsts: [
          { title: "第一步", date: "2026年3月2日" },
          { title: "第一次叫妈妈", date: "2026年5月9日" },
        ],
      }),
    );
    expect(rich.height).toBeGreaterThan(bare.height);
    expect(rich.noteLines.length).toBeGreaterThan(2);
    expect(rich.noteHeadingY).not.toBeNull();
    expect(rich.coverPhoto?.h).toBeGreaterThanOrEqual(320);
    expect(rich.coverPhoto!.h / rich.coverPhoto!.w).toBeLessThanOrEqual(0.8);
    expect(rich.firsts.map((f) => f.title)).toEqual(["第一步", "第一次叫妈妈"]);
    expect(rich.firsts[1]!.y).toBeGreaterThan(rich.firsts[0]!.y);
  });
  it("caps firsts and total height for runaway years", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      title: `第 ${i + 1} 件事`,
      date: "2026年3月2日",
    }));
    const layout = layoutYearbook(input({ firsts: many }));
    expect(layout.firsts).toHaveLength(YEARBOOK_MAX_FIRSTS);
    const tall = layoutYearbook(
      input({
        note: "长".repeat(4000),
        months: months(12, Array.from({ length: 12 }, (_, i) => i)),
        firsts: many,
        coverAspect: 1,
      }),
    );
    expect(tall.height).toBeLessThanOrEqual(YEARBOOK_MAX_HEIGHT);
  });
});

const source = (overrides: Partial<YearBookSource> = {}): YearBookSource => ({
  year: "2026",
  profileName: "桉桉",
  stats: "2 段时光",
  note: "",
  months: [],
  firsts: [],
  colophon: "2026 年",
  ...overrides,
});
const march = (
  records: YearBookSource["months"][number]["records"],
  label = "三月",
) => ({ label, records });

describe("年度册的内容装配", () => {
  it("把本名与来历带进扉页，未填时不带键，也不凭空补小名", () => {
    const fields = { fullName: "林知夏", motto: "名字来自夏天的第一阵风。" };
    expect(yearBookInput(source(fields)).titlePage).toEqual({ name: "桉桉", ...fields });
    expect(yearBookInput(source()).titlePage).toEqual({ name: "桉桉" });
    for (const key of ["fullName", "motto"] as const) {
      expect(yearBookInput(source()).titlePage).not.toHaveProperty(key);
      expect(yearBookInput(source({ [key]: fields[key] })).titlePage).toEqual({ name: "桉桉", [key]: fields[key] });
    }
    expect(yearBookInput(source({ ...fields, profileName: "" })).titlePage).toEqual({ name: "林知夏", motto: fields.motto });
  });
  it("寄语在最前，空月不出章，「第一次」收在最后", () => {
    const book = yearBookInput(
      source({
        note: "  这一年你学会了走路。  ",
        months: [
          march([
            {
              title: "第一步",
              date: "3月2日",
              text: "扶着沙发挪了三步。",
              photos: [{ key: "a", aspect: 1 }],
            },
          ]),
          march([], "四月"),
        ],
        firsts: [{ title: "第一步", date: "3月2日" }],
      }),
    );
    expect(book.chapters.map((c) => c.heading)).toEqual([
      "爸爸妈妈的话",
      "三月",
      "这一年的第一次",
    ]);
    expect(book.chapters[0]!.blocks).toEqual([
      { kind: "text", body: "这一年你学会了走路。" },
    ]);
    expect(book.title).toBe("桉桉的 2026 年");
    expect(book.stamp).toBe("2026");
  });

  it("一条记录的照片一张不落，且排在这条的文字后面", () => {
    const photos = [
      { key: "a", aspect: 1 },
      { key: "b", aspect: 1.5 },
      { key: "c", aspect: 0.8 },
    ];
    const book = yearBookInput(
      source({
        months: [
          march([{ title: "赶海", date: "3月2日", text: "第一次踩到浪。", photos }]),
        ],
      }),
    );
    expect(book.chapters[0]!.blocks).toEqual([
      { kind: "text", title: "赶海", date: "3月2日", body: "第一次踩到浪。" },
      { kind: "photos", photos },
    ]);
    // 记录带落款时文字块带上它；没落款不多出键。
    const signed = yearBookInput(
      source({
        months: [march([{ title: "赶海", date: "3月2日", text: "第一次踩到浪。", by: "爸爸", photos: [] }])],
      }),
    );
    expect(signed.chapters[0]!.blocks).toEqual([
      { kind: "text", title: "赶海", date: "3月2日", body: "第一次踩到浪。", by: "爸爸" },
    ]);
  });

  it("没有文字的记录不排空正文，没有寄语与第一次就不出那两章", () => {
    const book = yearBookInput(
      source({
        months: [
          march([
            { title: " ", date: "3月2日", text: "  ", photos: [{ key: "a", aspect: 1 }] },
          ]),
        ],
      }),
    );
    expect(book.chapters.map((c) => c.heading)).toEqual(["三月"]);
    expect(book.chapters[0]!.blocks).toEqual([
      { kind: "photos", photos: [{ key: "a", aspect: 1 }] },
    ]);
  });

  it("没填名字时落到桉桉，生日有才排进扉页", () => {
    expect(yearBookInput(source({ profileName: "  " })).title).toBe(
      "桉桉的 2026 年",
    );
    expect(yearBookInput(source()).titlePage).toEqual({ name: "桉桉" });
    expect(
      yearBookInput(source({ birthday: "2025 年 9 月 10 日" })).titlePage,
    ).toEqual({ name: "桉桉", birthday: "2025 年 9 月 10 日" });
  });
});
