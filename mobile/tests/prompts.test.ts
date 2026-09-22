import { describe, expect, it } from "vitest";
import {
  STORY_PROMPTS,
  dailyPromptOf,
  isStoryDay,
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

describe("family questions in the daily prompt", () => {
  const days = Array.from({ length: 60 }, (_, i) => new Date(2026, 8, 18 + i));

  it("keeps 24 unique questions, six per topic in the original order", () => {
    expect(STORY_PROMPTS).toHaveLength(24);
    expect(new Set(STORY_PROMPTS).size).toBe(24);
    const topics = ["出生那天", "怀孕的日子", "名字的来历", "我们怎么认识的"];
    for (const [index, topic] of topics.entries()) {
      expect(STORY_PROMPTS.filter((q) => q.startsWith(`${topic}：`))).toHaveLength(6);
      expect(STORY_PROMPTS.slice(index * 6, index * 6 + 6).every((q) => q.startsWith(`${topic}：`))).toBe(true);
    }
  });
  it("prioritizes family questions in the first months and agrees with the request gate", () => {
    const birthday = "2026-08-18";
    expect(days.filter((day) => isStoryDay(birthday, day)).length).toBeGreaterThanOrEqual(30);
    for (const day of days) {
      const list = isStoryDay(birthday, day) ? STORY_PROMPTS : promptsFor(bandOf(birthday, day));
      expect(list).toContain(dailyPromptOf(birthday, day));
    }
  });
  it("stops family questions after the first birthday, including changed seeds", () => {
    for (const day of days) {
      expect(isStoryDay("2025-08-18", day)).toBe(false);
      for (const seed of [0, 1, 2, 7])
        expect(dailyPromptOf("2025-08-18", day, seed)).toBe(promptOf("2025-08-18", day, seed));
    }
  });
  it("occasionally asks family questions without a usable birthday or at 6–11 months", () => {
    for (const birthday of ["", "not-a-date", "2027-01-01", "2026-03-18"]) {
      const count = days.filter((day) => isStoryDay(birthday, day)).length;
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(30);
      for (const day of days) {
        const list = isStoryDay(birthday, day) ? STORY_PROMPTS : promptsFor(bandOf(birthday, day));
        expect(list).toContain(dailyPromptOf(birthday, day));
      }
    }
  });
  it("returns the same question for the same birthday, day and seed", () => {
    for (const birthday of ["", "2026-08-18", "2026-03-18", "2025-08-18"]) {
      for (const day of days) {
        expect(dailyPromptOf(birthday, day)).toBe(dailyPromptOf(birthday, day, 0));
        for (const seed of [0, 1, 2, 7]) {
          expect(dailyPromptOf(birthday, day, seed)).toBe(
            dailyPromptOf(birthday, new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23), seed),
          );
        }
      }
    }
    expect(new Set(Array.from({ length: 20 }, (_, seed) => dailyPromptOf("2026-08-18", today, seed))).size).toBeGreaterThan(1);
  });
});
