import { describe, it, expect } from "vitest";
import {
  emptyLibrary,
  emptyContent,
  validateLibrary,
  type RecordDraft,
} from "../src/local/model";
import {
  moveProposalPhoto,
  polishRequest,
  proposalPatch,
  proposalEvents,
  requestImageIds,
  sameDayChunks,
  sameJob,
  sourceFingerprint,
  validateResult,
  POLISH_BODY_LIMIT,
  POLISH_CONTEXT_LIMIT,
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
  it("builds polish requests from title and body only, refusing instead of truncating", () => {
    expect(polishRequest({ title: "公园", text: "今天去公园。" }).context).toBe(
      "标题：公园\n正文：\n今天去公园。",
    );
    expect(polishRequest({ title: "", text: "只写正文" }).context).toBe(
      "正文：\n只写正文",
    );
    // Whitespace is preserved verbatim: polishing never rewrites the original.
    expect(
      polishRequest({ title: "公园", text: "  今天去公园。  " }).context,
    ).toBe("标题：公园\n正文：\n  今天去公园。  ");
    const empty = polishRequest({ title: "只有标题", text: "   " });
    expect(empty.error).toContain("正文");
    const long = polishRequest({
      title: "",
      text: "长".repeat(POLISH_BODY_LIMIT + 1),
    });
    expect(long.error).toContain(String(POLISH_BODY_LIMIT));
    expect(long.error).toContain("不会自动截断");
    expect(long.context).toBe("");
  });
  it("never reuses a generate job for polish, and treats stored jobs without a mode as generate", () => {
    const next = {
      fingerprint: "f".repeat(64),
      kind: "write" as const,
      eventIndex: 0,
      model: "deepseek-flash:high",
      writingMode: "polish" as const,
    };
    expect(sameJob(undefined, next)).toBe(false);
    expect(
      sameJob({ ...next, writingMode: undefined, steps: [] }, next),
    ).toBe(false);
    expect(sameJob({ ...next, steps: [] }, next)).toBe(true);
    expect(
      sameJob(
        { ...next, steps: [], writingMode: "generate" as const },
        { ...next, writingMode: "generate" as const },
      ),
    ).toBe(true);
  });
  it("writes polished text straight into a text-only draft that survives save and restore", () => {
    const { library } = fixture();
    const draft: RecordDraft = {
      id: "text-only",
      recordId: null,
      baseRevision: 0,
      content: { ...emptyContent(), title: "我的原稿", text: "今天第一次自己走完了全园。" },
      updatedAt: new Date().toISOString(),
    };
    library.drafts[draft.id] = draft;
    const patch = proposalPatch(
      draft,
      library.media,
      {
        fingerprint: sourceFingerprint(draft, library.media),
        kind: "write",
        eventIndex: 0,
        model: "deepseek-flash:high",
        writingMode: "polish",
        title: "自己走完",
        text: "今天第一次自己走完了整个园子。",
      },
    );
    expect(patch).toEqual({
      content: {
        ...draft.content,
        title: "自己走完",
        text: "今天第一次自己走完了整个园子。",
      },
    });
    if (!("content" in patch)) throw new Error("text-only draft must patch content");
    draft.content = patch.content;
    const restored = JSON.parse(JSON.stringify(library));
    validateLibrary(restored);
    expect(restored.drafts["text-only"]!.content.text).toBe(
      "今天第一次自己走完了整个园子。",
    );
  });
  it("keeps grouped drafts on photoEvents and honors partial adoption", () => {
    const { library, draft } = fixture();
    const proposal = {
      fingerprint: sourceFingerprint(draft, library.media),
      kind: "write" as const,
      eventIndex: 1,
      model: "deepseek-flash:high",
      writingMode: "generate" as const,
      title: "第二天的事",
      text: "新的画面。",
    };
    const full = proposalPatch(draft, library.media, proposal);
    expect("photoEvents" in full && full.photoEvents).toHaveLength(2);
    expect(
      "photoEvents" in full && full.photoEvents?.[1]!.title === "第二天的事",
    ).toBe(true);
    const bodyOnly = proposalPatch(draft, library.media, proposal, "text");
    expect(
      "photoEvents" in bodyOnly &&
        bodyOnly.photoEvents?.[1]!.title === "" &&
        bodyOnly.photoEvents?.[1]!.text === "新的画面。",
    ).toBe(true);
  });
  it("adjusts group preview membership without losing or duplicating photos", () => {
    const { library, draft } = fixture();
    const proposal = {
      fingerprint: sourceFingerprint(draft, library.media),
      kind: "group" as const,
      eventIndex: 0,
      model: "deepseek-flash:high",
      groups: [
        { photoIds: ["a", "b"], title: "上午", summary: "室内" },
        { photoIds: ["c"], title: "第二天", summary: "照片" },
      ],
    };
    const moved = moveProposalPhoto(proposal, "a", 1);
    expect(moved.groups?.map((g) => g.photoIds)).toEqual([["b"], ["c", "a"]]);
    expect(moveProposalPhoto(proposal, "a", 0).groups).toBe(proposal.groups);
    const emptied = moveProposalPhoto(proposal, "c", 0);
    expect(emptied.groups?.map((g) => g.photoIds)).toEqual([["a", "b", "c"]]);
  });
  it("sends every draft photo to grouping and only the chosen event to writing", () => {
    const { library, draft } = fixture();
    library.media.audio = {
      id: "audio",
      file: "audio.m4a",
      name: "audio.m4a",
      kind: "audio",
      bytes: 1,
      sha256: "b".repeat(64),
    };
    draft.content.mediaIds = ["a", "b", "c", "audio"];
    // 分组必须覆盖整份草稿，否则一次请求都不会发出。
    expect(requestImageIds("group", undefined, draft, library.media)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(requestImageIds("write", ["c", "b", "audio"], draft, library.media)).toEqual(
      ["c", "b"],
    );
    expect(requestImageIds("write", undefined, draft, library.media)).toEqual([]);
  });
  it("keeps every grouped event when day grouping is switched off before confirming", () => {
    const { library, draft } = fixture();
    draft.groupPhotosByDay = false;
    const proposal = {
      fingerprint: sourceFingerprint(draft, library.media),
      kind: "group" as const,
      eventIndex: 0,
      model: "deepseek-flash:high",
      groups: [
        { photoIds: ["a", "b"], title: "上午", summary: "室内" },
        { photoIds: ["c"], title: "第二天", summary: "照片" },
      ],
    };
    const patch = proposalPatch(draft, library.media, proposal);
    // 关闭按天分组只是不再自动按日期拆分，确认分组后每条事情都要保留。
    expect("photoEvents" in patch && patch.photoEvents?.map((e) => e.mediaIds)).toEqual([
      ["a", "b"],
      ["c"],
    ]);
    expect("photoEvents" in patch && patch.groupPhotosByDay).toBe(true);
  });
  it("refuses an oversized title and body envelope instead of sending a generic error", () => {
    const longTitle = polishRequest({
      title: "题".repeat(POLISH_CONTEXT_LIMIT - 10),
      text: "正文。",
    });
    expect(longTitle.context).toBe("");
    expect(longTitle.error).toContain(String(POLISH_CONTEXT_LIMIT));
    expect(
      polishRequest({
        title: "题".repeat(POLISH_CONTEXT_LIMIT - 20),
        text: "正文。",
      }).context,
    ).not.toBe("");
  });
});
