import { describe, expect, it } from "vitest";
import { ARCHIVE_VIEWER_HTML } from "../src/local/archive-viewer";
import { planArchive } from "../src/local/archive-layout";
import { emptyLibrary, type Library } from "../src/local/model";

type Node = {
  innerHTML: string;
  value: string;
  addEventListener: () => void;
};
/** 桩 DOM：只提供页面脚本用到的几个入口，渲染结果落在 innerHTML 里。 */
function run(library: unknown) {
  const nodes: Record<string, Node> = {};
  const document = {
    getElementById: (id: string) =>
      (nodes[id] ??= { innerHTML: "", value: "", addEventListener() {} }),
  };
  const window: Record<string, unknown> = { ANAN_LIBRARY: library, document };
  const script = ARCHIVE_VIEWER_HTML.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  new Function("window", "document", script)(window, document);
  const viewer = window.ANAN_VIEWER as {
    go: (patch: Record<string, string>) => void;
    state: Record<string, string>;
  };
  return { nodes, viewer };
}
function sample(): Library {
  const s = emptyLibrary();
  s.profile.name = "桉桉";
  s.profile.birthday = "2024-06-15";
  s.media.p = { id: "p", file: "p.jpg", name: "照片 <1>.jpg", kind: "image", bytes: 1, sha256: "a".repeat(64) };
  s.media.a = { id: "a", file: "a.m4a", name: "录音.m4a", kind: "audio", bytes: 1, sha256: "a".repeat(64) };
  s.persons.mom = { id: "mom", name: "妈妈" };
  s.records.r1 = {
    id: "r1", title: "第一次挥手 <b>", text: "今天 & 明天", date: "2026-09-15T10:00:00.000", location: "家里",
    first: true, mediaIds: ["p", "a"], coverId: "p", personIds: ["mom"], revision: 1, updatedAt: "2026-09-15T10:00:00.000",
  };
  s.records.r2 = {
    id: "r2", title: "去年", text: "旧事", date: "2025-01-15T10:00:00.000", location: "",
    first: false, mediaIds: [], coverId: null, revision: 1, updatedAt: "2025-01-15T10:00:00.000",
  };
  s.albums.al = { id: "al", name: "我们的日子", items: [{ id: "i", recordId: "r1" }], coverId: null, updatedAt: "2026-09-16T00:00:00.000Z", note: "寄语" };
  s.yearNotes["2026"] = "慢慢长大";
  s.letters.sealed = {
    id: "sealed", title: "还没拆", text: "秘密内容", from: "爸爸", openAt: "2999-01-01", writtenAt: "2026-04-01T10:00:00.000",
    sealed: true, mediaIds: [], coverId: null, updatedAt: "2026-04-01T10:00:00.000",
  };
  s.letters.opened = {
    id: "opened", title: "拆过", text: "公开内容", from: "妈妈", openAt: "2999-01-01", writtenAt: "2026-03-01T10:00:00.000",
    sealed: true, openedAt: "2026-09-01T10:00:00.000", mediaIds: [], coverId: null, updatedAt: "2026-09-01T10:00:00.000",
  };
  return s;
}
const libraryOf = (s: Library) =>
  planArchive(s, { now: new Date(2026, 8, 19), includeSealedLetters: true }).library;

describe("offline archive viewer", () => {
  it("is self-contained: no network references, data from library.js", () => {
    expect(ARCHIVE_VIEWER_HTML).not.toMatch(/https?:\/\//);
    expect(ARCHIVE_VIEWER_HTML).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket)\s*\(/);
    expect(ARCHIVE_VIEWER_HTML).toContain('<script src="library.js"></script>');
    expect(ARCHIVE_VIEWER_HTML).toContain('<meta charset="utf-8">');
    expect(ARCHIVE_VIEWER_HTML.startsWith("<!doctype html>")).toBe(true);
  });
  it("renders an empty archive and a missing library without throwing", () => {
    const empty = run(libraryOf(emptyLibrary()));
    expect(empty.nodes.content!.innerHTML).toContain("还没有记录");
    expect(empty.nodes.title!.innerHTML).toBe("成长记录的成长记录");
    const missing = run(undefined);
    expect(missing.nodes.content!.innerHTML).toContain("找不到 library.js");
  });
  it("lists records with escaped text, encoded media paths and month navigation", () => {
    const { nodes, viewer } = run(libraryOf(sample()));
    const content = nodes.content!.innerHTML;
    expect(nodes.title!.innerHTML).toBe("桉桉的成长记录");
    expect(nodes.subtitle!.innerHTML).toContain("2 条记录 · 生日 2024年6月15日");
    expect(content).toContain("第一次挥手 &lt;b&gt;");
    expect(content).toContain("今天 &amp; 明天");
    expect(content).toContain('<span class="badge">第一次</span>');
    expect(content).toContain("2 岁 3 个月");
    expect(content).toContain('src="%E8%AE%B0%E5%BD%95/2026/2026-09-15%20%E7%AC%AC%E4%B8%80%E6%AC%A1%E6%8C%A5%E6%89%8B%20b/%E7%85%A7%E7%89%871.jpg"');
    expect(content).toContain("<audio controls");
    expect(content.indexOf("去年")).toBeLessThan(content.indexOf("第一次挥手"));
    expect(nodes.side!.innerHTML).toContain('data-month="2026-09">9月');
    expect(nodes.tabs!.innerHTML).toContain('data-tab="firsts"');
    expect(nodes.tabs!.innerHTML).not.toContain('data-tab="quotes"');
    viewer.go({ month: "2025-01", year: "2025" });
    expect(nodes.content!.innerHTML).not.toContain("第一次挥手");
    expect(nodes.content!.innerHTML).toContain("去年");
    viewer.go({ month: "", year: "", query: "明天" });
    expect(nodes.content!.innerHTML).toContain("第一次挥手");
    expect(nodes.content!.innerHTML).not.toContain(">去年<");
  });
  it("keeps a sealed letter closed until its day and shows opened ones", () => {
    const { nodes, viewer } = run(libraryOf(sample()));
    viewer.go({ tab: "letters" });
    const content = nodes.content!.innerHTML;
    expect(content).toContain("封存至 2999年1月1日 · 爸爸");
    expect(content).not.toContain("秘密内容");
    expect(content).toContain("公开内容");
    expect(content).toContain("—— 妈妈");
    viewer.go({ tab: "albums" });
    expect(nodes.content!.innerHTML).toContain("我们的日子");
    expect(nodes.content!.innerHTML).toContain("第一次挥手");
    viewer.go({ tab: "notes" });
    expect(nodes.content!.innerHTML).toContain("2026 年的话");
    viewer.go({ tab: "persons" });
    expect(nodes.content!.innerHTML).toContain("妈妈");
  });
});
