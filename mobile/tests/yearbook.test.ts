import { describe, expect, it } from "vitest";
import {
  MONTH_COLUMNS,
  YEARBOOK_MAX_FIRSTS,
  YEARBOOK_MAX_HEIGHT,
  YEARBOOK_WIDTH,
  layoutYearbook,
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
    profileName: "小美",
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
