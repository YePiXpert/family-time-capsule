import { describe, expect, it } from "vitest";
import {
  ageInMonths,
  bandOf,
  promptOf,
  promptsFor,
  type PromptBand,
} from "../src/local/prompts";

const bands: PromptBand[] = ["0-6m", "6-12m", "1-2y", "2-4y", "4y+"];
const today = new Date(2026, 8, 18);

describe("daily writing prompts", () => {
  it("keeps at least 120 non-empty, band-unique questions", () => {
    const all = bands.flatMap((band) => promptsFor(band));
    expect(all.length).toBeGreaterThanOrEqual(120);
    for (const band of bands) {
      const list = promptsFor(band);
      expect(list.length).toBeGreaterThanOrEqual(20);
      expect(list.every((q) => q.trim().length > 0)).toBe(true);
      expect(new Set(list).size).toBe(list.length);
    }
    // 跨段可以有重复措辞，但同段内必须唯一。
    expect(new Set(all).size).toBeGreaterThan(100);
  });
  it("returns the same question for the same day and seed", () => {
    const birthday = "2025-03-18";
    const first = promptOf(birthday, today);
    expect(promptOf(birthday, today)).toBe(first);
    expect(promptOf(birthday, today, 0)).toBe(first);
    // 同一天多次换种子至少能换出别的问题。
    const seeds = [1, 2, 3, 4, 5].map((seed) => promptOf(birthday, today, seed));
    expect(new Set([first, ...seeds]).size).toBeGreaterThan(1);
  });
  it("picks from the band matching the age", () => {
    const cases: [string, PromptBand][] = [
      ["2026-09-18", "0-6m"],
      ["2026-03-18", "6-12m"],
      ["2025-09-18", "1-2y"],
      ["2024-09-18", "2-4y"],
      ["2022-09-18", "4y+"],
    ];
    for (const [birthday, band] of cases) {
      expect(bandOf(birthday, today)).toBe(band);
      expect(promptsFor(band)).toContain(promptOf(birthday, today));
    }
  });
  it("switches bands on boundary birthdays", () => {
    // 满 6 个月的前一天仍属新生儿段，当天即切换。
    expect(bandOf("2026-03-19", today)).toBe("0-6m");
    expect(bandOf("2026-03-18", today)).toBe("6-12m");
    expect(ageInMonths("2026-03-18", today)).toBe(6);
    expect(ageInMonths("2026-03-19", today)).toBe(5);
    // 出生当天从第 0 个月开始。
    expect(ageInMonths("2026-09-18", today)).toBe(0);
  });
  it("falls back to the newborn band without a usable birthday", () => {
    expect(ageInMonths("", today)).toBeNull();
    expect(ageInMonths("not-a-date", today)).toBeNull();
    expect(ageInMonths("2026-12-01", today)).toBeNull();
    expect(bandOf("", today)).toBe("0-6m");
    expect(promptsFor("0-6m")).toContain(promptOf("", today));
  });
});
