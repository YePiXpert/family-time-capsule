import { describe, it, expect } from "vitest";
import {
  emptyLibrary,
  emptyContent,
  validateLibrary,
  type RecordDraft,
} from "../src/local/model";
import {
  proposalEvents,
  sameDayChunks,
  sourceFingerprint,
  validateResult,
} from "../src/ai/state";
function fixture() {
  const library = emptyLibrary();
  for (const [id, day] of [
    ["a", "2020-01-01"],
    ["b", "2020-01-01"],
    ["c", "2020-01-02"],
  ])
    library.media[id!] = {
      id: id!,
      file: `${id}.jpg`,
      kind: "image",
      name: `${id}.jpg`,
      bytes: 1,
      sha256: "a".repeat(64),
      photoMetadata: { capturedAt: `${day}T12:00:00` },
    };
  const draft: RecordDraft = {
    id: "draft",
    recordId: null,
    baseRevision: 0,
    content: { ...emptyContent(), mediaIds: ["a", "b", "c"], coverId: "a" },
    groupPhotosByDay: true,
    updatedAt: new Date().toISOString(),
  };
  library.drafts.draft = draft;
  return { library, draft };
}
describe("AI suggestions remain reviewable local drafts", () => {
  it("rejects delayed suggestions after text, photo or grouping changes", () => {
    const { library, draft } = fixture();
    const fingerprint = sourceFingerprint(draft, library.media);
    const proposal = {
      fingerprint,
      kind: "write" as const,
      eventIndex: 0,
      model: "deepseek-flash",
      title: "散步",
      text: "一起去公园。",
    };
    draft.content.text = "我的新输入";
    expect(() => proposalEvents(draft, library.media, proposal)).toThrow(
      "已修改",
    );
    expect(draft.content.text).toBe("我的新输入");
  });
  it("splits two same-day events and preserves the existing caption exactly once", () => {
    const { library, draft } = fixture();
    draft.content.text = "用户亲自写下的文字";
    const proposal = {
      fingerprint: sourceFingerprint(draft, library.media),
      kind: "group" as const,
      eventIndex: 0,
      model: "deepseek-flash",
      groups: [
        { photoIds: ["a"], title: "上午", summary: "室内" },
        { photoIds: ["b"], title: "下午", summary: "户外" },
        { photoIds: ["c"], title: "第二天", summary: "照片" },
      ],
    };
    const events = proposalEvents(draft, library.media, proposal);
    expect(events.map((e) => e.mediaIds)).toEqual([["a"], ["b"], ["c"]]);
    expect(events[0]!.date.slice(0, 10)).toBe(events[1]!.date.slice(0, 10));
    expect(events[0]!.text).toBe("用户亲自写下的文字");
    expect(events[1]!.text).toBe("");
    expect(draft.photoEvents).toBeUndefined();
  });
  it("does not accept omitted, duplicate, invented or cross-day group membership", () => {
    for (const ids of [["a"], ["a", "a"], ["a", "fake"]])
      expect(() =>
        validateResult(
          { groups: [{ photoIds: ids, title: "x", summary: "x" }] },
          "group",
          ["a", "b"],
        ),
      ).toThrow();
    const { library, draft } = fixture();
    expect(() =>
      proposalEvents(draft, library.media, {
        fingerprint: sourceFingerprint(draft, library.media),
        kind: "group",
        eventIndex: 0,
        model: "x",
        groups: [{ photoIds: ["a", "b", "c"], title: "x", summary: "x" }],
      }),
    ).toThrow("不同日期");
  });
  it("preserves a manually written title when only adopting generated body", () => {
    const { library, draft } = fixture();
    draft.content.title = "手动标题";
    const events = proposalEvents(draft, library.media, {
      fingerprint: sourceFingerprint(draft, library.media),
      kind: "write",
      eventIndex: 0,
      model: "x",
      text: "AI 正文",
    });
    expect(events[0]!.title).toBe("手动标题");
    expect(events[0]!.text).toBe("AI 正文");
  });
  it("persists request IDs and suggestions through backup snapshots without credentials or images", () => {
    const { library, draft } = fixture();
    const fingerprint = sourceFingerprint(draft, library.media);
    draft.aiJob = {
      fingerprint,
      kind: "write",
      eventIndex: 0,
      model: "x",
      steps: [
        {
          key: "write",
          requestId: "request",
          result: { title: "标题", text: "正文" },
        },
      ],
    };
    draft.aiProposal = {
      fingerprint,
      kind: "write",
      eventIndex: 0,
      model: "x",
      title: "标题",
      text: "正文",
    };
    const restored = JSON.parse(JSON.stringify(library));
    validateLibrary(restored);
    expect(restored.drafts.draft!.aiJob!.steps[0]!.requestId).toBe("request");
    Object.assign(restored.drafts.draft!.aiJob!.steps[0]!.result!, {
      text: {},
    });
    expect(() => validateLibrary(restored)).toThrow();
  });
  it("chunks large same-day imports without mixing known days", () => {
    const { library } = fixture();
    const ids = [];
    for (let i = 0; i < 45; i++) {
      const id = `photo${i}`;
      ids.push(id);
      library.media[id] = { ...library.media.a!, id };
    }
    const days = sameDayChunks([...ids, "c"], library.media);
    expect(days.map((day) => day.chunks.map((c) => c.length))).toEqual([
      [20, 20, 5],
      [1],
    ]);
    expect(days.flatMap((d) => d.chunks.flat())).toHaveLength(46);
  });
});
