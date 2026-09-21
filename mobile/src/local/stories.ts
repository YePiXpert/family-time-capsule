import type { RecordContent, StoryTopic } from "./model";

export const STORY_TOPICS: readonly StoryTopic[] = [
  "birth", "pregnancy", "name", "met",
];

const topics: Record<
  StoryTopic,
  { title: string; lead: string; questions: readonly string[] }
> = {
  birth: {
    title: "出生那天",
    lead: "你来到这个世界的那一天。",
    questions: [
      "她是哪一天、几点出生的？",
      "那天的天气是什么样的？",
      "当时谁在身边？",
      "第一眼看见她时，你记住了什么？",
      "见到她后，你说的第一句话是什么？",
      "那之后还发生了什么？",
    ],
  },
  pregnancy: {
    title: "怀孕的日子",
    lead: "还没见到你，我们已经开始等你。",
    questions: [
      "是哪一天知道怀上她的？",
      "知道后，你们是什么反应？",
      "怀孕时，有哪件小事一直记得？",
      "取名字之前，你们怎么叫她？",
      "那时最担心什么？",
      "那时最期待什么？",
    ],
  },
  name: {
    title: "名字的来历",
    lead: "这是我们第一次叫你的名字。",
    questions: [
      "她的名字是谁在什么时候起的？",
      "这个名字有什么来历或出处？",
      "还考虑过哪些名字？",
      "她的小名是怎么来的？",
      "第一次叫她的名字时，是什么情景？",
      "希望这个名字带给她什么？",
    ],
  },
  met: {
    title: "我们怎么认识的",
    lead: "在你来到之前，我们先遇见了彼此。",
    questions: [
      "你们是什么时候、怎么认识的？",
      "对彼此的第一印象是什么？",
      "第一次约会是什么样的？",
      "什么时候决定在一起的？",
      "家里人知道后怎么说？",
      "关于你们的相遇，想对她说哪句话？",
    ],
  },
};

export const storyTitle = (topic: StoryTopic): string => topics[topic].title;
export const storyLead = (topic: StoryTopic): string => topics[topic].lead;
export const storyQuestions = (topic: StoryTopic): readonly string[] =>
  topics[topic].questions;

/** 除出生那天外，日期都是记述日期；故事发生的时间留在正文里。 */
export function storyDefaultDate(
  topic: StoryTopic,
  birthday: string,
  now = new Date(),
): string {
  if (topic === "birth" && /^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
    const [year, month, day] = birthday.split("-").map(Number);
    const date = new Date(`${birthday}T10:00:00`);
    if (
      year! > 0 &&
      date.getFullYear() === year &&
      date.getMonth() + 1 === month &&
      date.getDate() === day
    )
      return date.toISOString();
  }
  return now.toISOString();
}

export function storiesWritten(
  records: readonly Pick<RecordContent, "story">[],
): Record<StoryTopic, number> {
  const counts: Record<StoryTopic, number> = {
    birth: 0, pregnancy: 0, name: 0, met: 0,
  };
  for (const record of records) if (record.story) counts[record.story]++;
  return counts;
}
