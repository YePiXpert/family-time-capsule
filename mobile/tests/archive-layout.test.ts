import { describe, expect, it } from "vitest";
import {
  archiveRootName,
  planArchive,
  safeName,
  type ArchiveEntry,
} from "../src/local/archive-layout";
import { emptyLibrary, type Library, type LocalMedia } from "../src/local/model";

const NOW = new Date(2026, 8, 19, 9, 0, 0);

function media(id: string, kind: LocalMedia["kind"], ext: string, bytes = 10): LocalMedia {
  return { id, file: `${id}.${ext}`, name: `${id}.${ext}`, kind, bytes, sha256: "a".repeat(64) };
}
function record(
  s: Library,
  id: string,
  over: Partial<Library["records"][string]> & { date: string },
) {
  s.records[id] = {
    id,
    title: "",
    text: "",
    location: "",
    first: false,
    mediaIds: [],
    coverId: null,
    revision: 1,
    updatedAt: over.date,
    ...over,
  };
}
/** 时间戳不带时区后缀：按本地日历写死，任何时区下文件夹名一致。 */
function library(): Library {
  const s = emptyLibrary();
  s.profile.name = "桉桉";
  s.profile.birthday = "2024-06-15";
  s.media.p1 = media("p1", "image", "jpg", 100);
  s.media.p2 = media("p2", "image", "JPG", 200);
  s.media.v1 = media("v1", "video", "mp4", 3000);
  s.media.a1 = media("a1", "audio", "m4a", 50);
  s.media.orphan = media("orphan", "image", "jpg", 999);
  s.persons.mom = { id: "mom", name: "妈妈" };
  s.persons.dad = { id: "dad", name: "爸爸" };
  record(s, "r1", {
    date: "2026-09-15T10:00:00.000",
    title: "第一次挥手",
    text: "今天她朝我们挥手了。\n第二段。",
    location: "家里",
    first: true,
    mediaIds: ["p1", "v1", "p2"],
    coverId: "p1",
    personIds: ["mom", "dad"],
  });
  record(s, "r2", {
    date: "2026-09-15T18:00:00.000",
    title: "第一次挥手",
    text: "又挥了一次。",
    mediaIds: ["a1"],
    personIds: ["mom"],
  });
  record(s, "r3", { date: "2025-01-15T10:00:00.000", text: "去年的事。", quote: true });
  s.albums.al = {
    id: "al",
    name: "我们的日子",
    items: [
      { id: "i1", recordId: "r1" },
      { id: "i2", recordId: "r3" },
    ],
    coverId: null,
    updatedAt: "2026-09-16T00:00:00.000Z",
    note: "扉页的话",
  };
  s.albums.empty = {
    id: "empty",
    name: "空相册",
    items: [],
    coverId: null,
    updatedAt: "2026-09-16T00:00:00.000Z",
  };
  s.series.se = {
    id: "se",
    name: "同一把椅子",
    items: [{ recordId: "r1", mediaId: "p2", month: "2026-09" }],
    updatedAt: "2026-09-16T00:00:00.000Z",
  };
  s.yearNotes["2026"] = "慢慢长大。";
  s.yearNotes["2025"] = "去年的话。";
  s.letters.opened = {
    id: "opened",
    title: "给十八岁的你",
    text: "拆过的信。",
    from: "妈妈",
    openAt: "2042-06-15",
    writtenAt: "2026-03-01T10:00:00.000",
    sealed: true,
    openedAt: "2026-09-01T10:00:00.000",
    mediaIds: ["a1"],
    coverId: null,
    updatedAt: "2026-09-01T10:00:00.000",
  };
  s.letters.sealed = {
    id: "sealed",
    title: "还没拆",
    text: "秘密。",
    from: "爸爸",
    openAt: "2042-06-15",
    writtenAt: "2026-04-01T10:00:00.000",
    sealed: true,
    mediaIds: [],
    coverId: null,
    updatedAt: "2026-04-01T10:00:00.000",
  };
  s.letters.draft = {
    id: "draft",
    title: "草稿",
    text: "没写完。",
    from: "",
    openAt: "2042-06-15",
    writtenAt: "2026-05-01T10:00:00.000",
    sealed: false,
    mediaIds: [],
    coverId: null,
    updatedAt: "2026-05-01T10:00:00.000",
  };
  return s;
}
const paths = (entries: ArchiveEntry[]) => entries.map((e) => e.path);
const textOf = (entries: ArchiveEntry[], suffix: string) => {
  const e = entries.find((x) => x.kind === "text" && x.path.endsWith(suffix));
  if (!e || e.kind !== "text") throw new Error(`missing ${suffix}`);
  return e.text;
};

describe("safeName", () => {
  it("strips characters no file system accepts and trims Windows-unfriendly endings", () => {
    expect(safeName('a/b\\c:d*e?f"g<h>i|j')).toBe("a b c d e f g h i j");
    expect(safeName("  结尾的点... ")).toBe("结尾的点");
    expect(safeName("\u0001控制\u007f字符")).toBe("控制 字符");
    expect(safeName("   ")).toBe("未命名");
    expect(safeName("CON")).toBe("_CON");
    expect(safeName("com1")).toBe("_com1");
  });
  it("limits to sixty characters without splitting surrogate pairs", () => {
    const long = "😀".repeat(70);
    expect(Array.from(safeName(long)).length).toBe(60);
    expect(safeName(long).endsWith("😀")).toBe(true);
  });
});

describe("planArchive", () => {
  it("names the root after the child and the export day", () => {
    const s = library();
    expect(archiveRootName(s, NOW)).toBe("桉桉成长记归档-20260919");
    s.profile.name = "  ";
    expect(archiveRootName(s, NOW)).toBe("桉桉成长记归档-20260919");
    s.profile.name = "小 美/2";
    expect(archiveRootName(s, NOW)).toBe("小 美 2成长记归档-20260919");
  });
  it("gives every record its own folder with readable media names", () => {
    const plan = planArchive(library(), { now: NOW });
    const root = "桉桉成长记归档-20260919";
    expect(plan.root).toBe(root);
    const all = paths(plan.entries);
    expect(all).toContain(`${root}/记录/2026/2026-09-15 第一次挥手/正文.md`);
    expect(all).toContain(`${root}/记录/2026/2026-09-15 第一次挥手/照片1.jpg`);
    expect(all).toContain(`${root}/记录/2026/2026-09-15 第一次挥手/照片2.jpg`);
    expect(all).toContain(`${root}/记录/2026/2026-09-15 第一次挥手/视频1.mp4`);
    // 同一天同名的第二条加 (2)。
    expect(all).toContain(`${root}/记录/2026/2026-09-15 第一次挥手 (2)/正文.md`);
    expect(all).toContain(`${root}/记录/2026/2026-09-15 第一次挥手 (2)/录音1.m4a`);
    // 没标题的记录用正文首行。
    expect(all).toContain(`${root}/记录/2025/2025-01-15 去年的事。/正文.md`);
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((p) => p.startsWith(`${root}/`))).toBe(true);
  });
  it("writes front matter, body and relative media links", () => {
    const body = textOf(planArchive(library(), { now: NOW }).entries, "第一次挥手/正文.md");
    expect(body).toContain("---\n日期: 2026-09-15\n标题: 第一次挥手\n地点: 家里\n人物: 妈妈, 爸爸\n第一次: 是\n---\n");
    expect(body).not.toContain("她说的话");
    expect(textOf(planArchive(library(), { now: NOW }).entries, "去年的事。/正文.md")).toContain("她说的话: 是");
    // 落款：写进头部，也作为正文末尾靠右的一行；没落款的记录两处都没有。
    const signed = library();
    signed.records.r3 = { ...signed.records.r3!, by: "外婆" };
    const plan = planArchive(signed, { now: NOW });
    const grandma = textOf(plan.entries, "去年的事。/正文.md");
    expect(grandma).toContain("落款: 外婆\n她说的话: 是\n---\n");
    expect(grandma).toContain("去年的事。\n\n—— 外婆\n");
    expect(grandma).not.toContain("第一次: 是");
    expect(textOf(plan.entries, "第一次挥手/正文.md")).not.toContain("落款");
    expect(plan.library.records.find((r) => r.id === "r3")?.by).toBe("外婆");
    expect(plan.library.records.find((r) => r.id === "r1")?.by).toBeUndefined();
    expect(body).toContain("# 第一次挥手\n\n今天她朝我们挥手了。\n第二段。\n");
    expect(body).toContain("![照片1.jpg](<照片1.jpg>)");
    expect(body).toContain("[视频1.mp4](<视频1.mp4>)");
  });
  it("lists albums and series with links into the record folders", () => {
    const { entries } = planArchive(library(), { now: NOW });
    const album = textOf(entries, "相册/我们的日子.md");
    expect(album).toContain("# 我们的日子\n\n扉页的话\n\n");
    expect(album).toContain("- [2026-09-15 第一次挥手](<../记录/2026/2026-09-15 第一次挥手/正文.md>)");
    expect(album).toContain("- [2025-01-15 去年的事。](<../记录/2025/2025-01-15 去年的事。/正文.md>)");
    expect(paths(entries).some((p) => p.endsWith("空相册.md"))).toBe(false);
    const series = textOf(entries, "时光系列/同一把椅子.md");
    expect(series).toContain("- 2026-09 [第一次挥手](<../记录/2026/2026-09-15 第一次挥手/照片2.jpg>)");
    expect(textOf(entries, "寄语/2026.md")).toBe("# 2026 年的话\n\n慢慢长大。\n");
    expect(textOf(entries, "人物.md")).toBe("# 人物\n\n- 妈妈：2 条记录\n- 爸爸：1 条记录\n");
  });
  it("keeps sealed letters out unless asked, never archives drafts", () => {
    const base = planArchive(library(), { now: NOW });
    const all = paths(base.entries);
    expect(all).toContain("桉桉成长记归档-20260919/信/2026-03-01 妈妈 给十八岁的你/信.md");
    expect(all).toContain("桉桉成长记归档-20260919/信/2026-03-01 妈妈 给十八岁的你/录音1.m4a");
    expect(all.some((p) => p.includes("还没拆"))).toBe(false);
    expect(all.some((p) => p.includes("草稿"))).toBe(false);
    const opened = textOf(base.entries, "给十八岁的你/信.md");
    expect(opened).toContain("写于: 2026-03-01\n落款: 妈妈\n拆封日: 2042-06-15\n拆封于: 2026-09-01\n状态: 已拆封");
    expect(opened).toContain("拆过的信。\n\n—— 妈妈\n");
    const withSealed = planArchive(library(), { now: NOW, includeSealedLetters: true });
    expect(paths(withSealed.entries)).toContain("桉桉成长记归档-20260919/信/2026-04-01 爸爸 还没拆/信.md");
    expect(textOf(withSealed.entries, "还没拆/信.md")).toContain("状态: 还没拆封");
    expect(withSealed.library.letters.map((l) => l.id)).toEqual(["opened", "sealed"]);
    expect(paths(withSealed.entries).some((p) => p.includes("草稿"))).toBe(false);
  });
  it("filters by year across records, albums, notes and letters", () => {
    const plan = planArchive(library(), { now: NOW, year: "2025" });
    const all = paths(plan.entries);
    expect(all.filter((p) => p.includes("/记录/"))).toEqual([
      "桉桉成长记归档-20260919/记录/2025/2025-01-15 去年的事。/正文.md",
    ]);
    expect(textOf(plan.entries, "相册/我们的日子.md")).not.toContain("第一次挥手");
    expect(all.some((p) => p.includes("时光系列"))).toBe(false);
    expect(all.some((p) => p.endsWith("寄语/2026.md"))).toBe(false);
    expect(all.some((p) => p.endsWith("寄语/2025.md"))).toBe(true);
    expect(plan.library.letters).toEqual([]);
    expect(plan.library.year).toBe("2025");
    expect(plan.library.persons).toEqual([]);
    expect(textOf(plan.entries, "README.txt")).toContain("只含 2025 年");
  });
  it("accounts for every media byte and points each media entry at a real file", () => {
    const s = library();
    const plan = planArchive(s, { now: NOW });
    const mediaEntries = plan.entries.filter((e) => e.kind === "media");
    expect(mediaEntries.every((e) => e.kind === "media" && !!s.media[e.mediaId])).toBe(true);
    // p1 + v1 + p2 + a1（记录）+ a1（信里再复制一份），孤儿素材不进归档。
    expect(plan.mediaCount).toBe(5);
    expect(plan.mediaBytes).toBe(100 + 3000 + 200 + 50 + 50);
    const firstMedia = plan.entries.findIndex((e) => e.kind === "media");
    expect(plan.entries.slice(firstMedia).every((e) => e.kind === "media")).toBe(true);
    expect(plan.entries.slice(0, firstMedia).every((e) => e.kind === "text")).toBe(true);
  });
  it("ships the same library as JSON and as a script the offline page can load", () => {
    const plan = planArchive(library(), { now: NOW, viewerHtml: "<!doctype html><title>x</title>" });
    const json = textOf(plan.entries, "library.json");
    expect(JSON.parse(json)).toEqual(plan.library);
    const js = textOf(plan.entries, "library.js");
    expect(js.startsWith("window.ANAN_LIBRARY = {")).toBe(true);
    expect(js.trimEnd().endsWith("};")).toBe(true);
    expect(textOf(plan.entries, "index.html")).toBe("<!doctype html><title>x</title>");
    expect(plan.library.child).toEqual({ name: "桉桉", birthday: "2024-06-15" });
    expect(plan.library.records.map((r) => r.id)).toEqual(["r3", "r1", "r2"]);
    expect(plan.library.records[1]!.media.map((m) => m.path)).toEqual([
      "记录/2026/2026-09-15 第一次挥手/照片1.jpg",
      "记录/2026/2026-09-15 第一次挥手/视频1.mp4",
      "记录/2026/2026-09-15 第一次挥手/照片2.jpg",
    ]);
    expect(plan.library.series[0]!.items[0]!.path).toBe("记录/2026/2026-09-15 第一次挥手/照片2.jpg");
    expect(planArchive(library(), { now: NOW }).entries.some((e) => e.path.endsWith("index.html"))).toBe(false);
  });
  it("copies the avatar to the root when the profile has one", () => {
    const s = library();
    s.profile.avatarId = "p1";
    const plan = planArchive(s, { now: NOW });
    expect(plan.library.child.avatar).toBe("头像.jpg");
    expect(paths(plan.entries)).toContain("桉桉成长记归档-20260919/头像.jpg");
    expect(plan.mediaCount).toBe(6);
  });
  it("survives an empty library", () => {
    const plan = planArchive(emptyLibrary(), { now: NOW });
    expect(paths(plan.entries)).toEqual([
      "桉桉成长记归档-20260919/README.txt",
      "桉桉成长记归档-20260919/library.json",
      "桉桉成长记归档-20260919/library.js",
    ]);
    expect(plan.mediaBytes).toBe(0);
  });
});

it("keeps version ancestry out of open archive text and viewer data", () => {
  const state = library();
  const plain = planArchive(state, { now: NOW, includeSealedLetters: true });
  for (const id of Object.keys(state.records))
    state.records[id] = { ...state.records[id]!, ancestors: ["abcdef0123456789"] };
  for (const id of Object.keys(state.letters))
    state.letters[id] = { ...state.letters[id]!, ancestors: ["0123456789abcdef"] };
  const withAncestry = planArchive(state, { now: NOW, includeSealedLetters: true });
  expect(withAncestry).toEqual(plain);
});
