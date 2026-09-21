import { describe, expect, it } from "vitest";
import { STORY_TOPICS, storyTitle, storyLead, storyQuestions, storyDefaultDate, storiesWritten } from "../src/local/stories";

const now = new Date("2026-09-21T12:34:56.000Z");

describe("出生的故事的固定引导", () => {
  it("按四主题顺序提供六个非空、不重复的问题和写给她的章首句", () => {
    expect(STORY_TOPICS).toEqual(["birth", "pregnancy", "name", "met"]);
    expect(STORY_TOPICS.map(storyTitle)).toEqual(["出生那天", "怀孕的日子", "名字的来历", "我们怎么认识的"]);
    for (const topic of STORY_TOPICS) {
      const questions = storyQuestions(topic);
      expect(questions).toHaveLength(6);
      expect(new Set(questions).size).toBe(6);
      expect(questions.every((question) => question.trim().length > 0)).toBe(true);
      expect(storyLead(topic)).toContain("你");
    }
  });
  it("出生日期取生日当天本地十点，支持闰日", () => {
    for (const birthday of ["2024-03-05", "2024-02-29"]) {
      const actual = new Date(storyDefaultDate("birth", birthday, now));
      expect(actual.getFullYear()).toBe(2024);
      expect(actual.getMonth() + 1).toBe(Number(birthday.slice(5, 7)));
      expect(actual.getDate()).toBe(Number(birthday.slice(8)));
      expect(actual.getHours()).toBe(10);
      expect(actual.getMinutes()).toBe(0);
    }
  });
  it("未填或无效生日，以及其余主题，使用记述日期", () => {
    for (const birthday of ["", "bad", "2023-02-29", "2024-04-31", "2024-13-01", "0000-01-01"])
      expect(storyDefaultDate("birth", birthday, now)).toBe(now.toISOString());
    for (const topic of STORY_TOPICS.filter((topic) => topic !== "birth"))
      expect(storyDefaultDate(topic, "2024-03-05", now)).toBe(now.toISOString());
  });
  it("每个主题可写多段，普通记录不计入", () => {
    expect(storiesWritten([])).toEqual({ birth: 0, pregnancy: 0, name: 0, met: 0 });
    expect(storiesWritten([{ story: "birth" }, {}, { story: "birth" }, { story: "met" }]))
      .toEqual({ birth: 2, pregnancy: 0, name: 0, met: 1 });
  });
});
