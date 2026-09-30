import { describe, expect, it } from "vitest";
import { LocalStore } from "../src/local/store";
import {
  emptyContent,
  emptyLibrary,
  referencedMedia,
  validateLibrary,
  type Library,
  type LocalRecord,
} from "../src/local/model";
import { restoreRecordVersion } from "../src/local/history";
import { emptyBase, mergeLibraries } from "../src/sync/merge";
import { importantDays } from "../src/local/reminders";
import { missingStoryYears } from "../src/local/stories";

async function libraryStore() {
  const store = new LocalStore({
    read: async () => null,
    write: async () => {},
  });
  await store.open();
  return store;
}
const record = (
  text: string,
  at = "2025-05-01T12:00:00.000Z",
): LocalRecord => ({
  ...emptyContent("爸爸"),
  id: "r",
  text,
  date: at,
  revision: 1,
  updatedAt: at,
});
describe("完整修改历史", () => {
  it("保留超过八次修改、记录修改者，恢复旧版作为新版本", async () => {
    const store = await libraryStore();
    await store.change((s) => {
      s.settings.by = "爸爸";
      s.records.r = record("原文");
    });
    const first = store.get().records.r!.history![0]!;
    for (let i = 0; i < 12; i++)
      await store.change((s) => {
        s.settings.by = "妈妈";
        s.records.r = {
          ...s.records.r!,
          text: `修改 ${i}`,
          revision: i + 2,
          updatedAt: `2025-05-${String(i + 2).padStart(2, "0")}T12:00:00.000Z`,
        };
      });
    expect(store.get().records.r!.history).toHaveLength(13);
    expect(store.get().records.r!.by).toBe("爸爸");
    expect(store.get().records.r!.history!.at(-1)!.by).toBe("妈妈");
    await store.change((s) =>
      restoreRecordVersion(s, "r", first.id, "2025-06-01T12:00:00.000Z"),
    );
    expect(store.get().records.r!.text).toBe("原文");
    expect(store.get().records.r!.history).toHaveLength(14);
  });
  it("并发双方的版本均保留，重复合并不会无限产生历史", async () => {
    const a = await libraryStore(),
      b = await libraryStore();
    await a.change((s) => {
      s.records.r = record("原文");
    });
    await b.change(
      (s) => Object.assign(s, JSON.parse(JSON.stringify(a.get()))),
      { versioned: true },
    );
    await a.change((s) => {
      s.settings.by = "爸爸";
      s.records.r = {
        ...s.records.r!,
        text: "爸爸的版本",
        updatedAt: "2025-05-02T12:00:00.000Z",
      };
    });
    await b.change((s) => {
      s.settings.by = "妈妈";
      s.records.r = {
        ...s.records.r!,
        text: "妈妈的版本",
        updatedAt: "2025-05-03T12:00:00.000Z",
      };
    });
    const remote = (library: Library) => [
      {
        deviceId: "b",
        deviceName: "妈妈",
        createdAt: "2025-05-04T12:00:00.000Z",
        library,
      },
    ];
    const one = mergeLibraries(
      a.get(),
      remote(b.get()),
      emptyBase(),
      "2025-05-04T12:00:00.000Z",
    );
    const two = mergeLibraries(
      one.next,
      remote(b.get()),
      one.base,
      "2025-05-05T12:00:00.000Z",
    );
    expect(one.next.records.r!.history!.map((h) => h.record!.text)).toEqual([
      "原文",
      "爸爸的版本",
      "妈妈的版本",
    ]);
    expect(two.next.records.r!.history).toEqual(one.next.records.r!.history);
    validateLibrary(two.next);
  });
  it("从当前记录移除的附件仍由历史保护", async () => {
    const store = await libraryStore();
    await store.change((s) => {
      s.media.photo = {
        id: "photo",
        file: "photo.jpg",
        name: "照片",
        kind: "image",
        bytes: 1,
        sha256: "a".repeat(64),
      };
      s.records.r = {
        ...record("照片"),
        mediaIds: ["photo"],
        coverId: "photo",
      };
    });
    await store.change((s) => {
      s.records.r = {
        ...s.records.r!,
        mediaIds: [],
        coverId: null,
        updatedAt: "2025-05-02T12:00:00.000Z",
      };
    });
    expect(referencedMedia(store.get()).has("photo")).toBe(true);
  });
});
it("生日与拆封同一天只通知一次，过去的日子不补发", () => {
  const s = emptyLibrary();
  s.profile.birthday = "2024-02-29";
  s.letters.l = {
    id: "l",
    title: "生日",
    text: "给你",
    from: "爸爸",
    openAt: "2027-02-28",
    sealed: true,
    writtenAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    mediaIds: [],
    coverId: null,
  };
  const planned = importantDays(s, new Date("2026-09-30T12:00:00"));
  expect(planned.filter((r) => r.date.getFullYear() === 2027)).toHaveLength(1);
  expect(planned.every((r) => r.date > new Date("2026-09-30T12:00:00"))).toBe(
    true,
  );
});
it("年度故事只选择有文字的已结束年份，不重生已有故事", () => {
  const s = emptyLibrary();
  s.records.r = record("写过的事");
  s.records.now = { ...record("今年", "2026-05-01T12:00:00Z"), id: "now" };
  expect(missingStoryYears(s, new Date("2026-09-30"))).toEqual(["2025"]);
  s.yearStories = {
    "2025": {
      title: "一年",
      paragraphs: [{ text: "写过的事", recordIds: ["r"] }],
      generatedAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  };
  expect(missingStoryYears(s, new Date("2026-09-30"))).toEqual([]);
});

it("较晚的自动年度故事不能覆盖家人的编辑，两边合并一致", () => {
  const local = emptyLibrary(),
    remote = emptyLibrary();
  const story = {
    title: "一年",
    paragraphs: [{ text: "手写的故事", recordIds: ["r"] }],
    generatedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    edited: true,
  };
  local.yearStories = { "2025": story };
  local.rootStamps = { "yearStories:2025": "2026-01-02T00:00:00Z" };
  remote.yearStories = {
    "2025": {
      ...story,
      edited: false,
      paragraphs: [{ text: "自动结果", recordIds: ["r"] }],
      updatedAt: "2026-01-03T00:00:00Z",
    },
  };
  remote.rootStamps = { "yearStories:2025": "2026-01-03T00:00:00Z" };
  const snapshot = (library: Library) => [
    {
      deviceId: "other",
      deviceName: "家人",
      createdAt: "2026-01-04T00:00:00Z",
      library,
    },
  ];
  expect(
    mergeLibraries(local, snapshot(remote), emptyBase(), "2026-01-04T00:00:00Z")
      .next.yearStories?.["2025"],
  ).toEqual(story);
  expect(
    mergeLibraries(remote, snapshot(local), emptyBase(), "2026-01-04T00:00:00Z")
      .next.yearStories?.["2025"],
  ).toEqual(story);
});
