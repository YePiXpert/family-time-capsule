import { describe, it, expect } from "vitest";
import {
  emptyLibrary,
  emptyContent,
  validateLibrary,
  type RecordDraft,
  type LocalRecord,
  type YearPicks,
} from "../src/local/model";
import {
  editorContext,
  checkEditorResult,
  applyYearPicks,
  askContext,
  questionContext,
  letterContext,
  questionPlan,
  rememberQuestion,
  validateStoredAI,
  moveProposalPhoto,
  polishRequest,
  proposalPatch,
  proposalEvents,
  recapContext,
  requestImageIds,
  retryPlan,
  sameDayChunks,
  sameJob,
  sourceFingerprint,
  validateResult,
  POLISH_BODY_LIMIT,
  POLISH_CONTEXT_LIMIT,
} from "../src/ai/state";

import { writeContext } from "../src/ai/plan";
import { AIError } from "../src/ai/error";
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
  it("keeps people, quote and author on every proposed event", () => {
    const { library, draft } = fixture();
    draft.content.personIds = ["妈妈", "爸爸"];
    draft.content.quote = true;
    draft.content.by = "妈妈";
    const events = proposalEvents(draft, library.media, {
      fingerprint: sourceFingerprint(draft, library.media),
      kind: "group",
      eventIndex: 0,
      model: "deepseek-flash",
      groups: [
        { photoIds: ["a"], title: "上午", summary: "室内" },
        { photoIds: ["b"], title: "下午", summary: "户外" },
        { photoIds: ["c"], title: "第二天", summary: "照片" },
      ],
    });
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(event.personIds).toEqual(["妈妈", "爸爸"]);
      expect(event.quote).toBe(true);
      expect(event.by).toBe("妈妈");
    }
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
      model: "mimo-v2.5:policy-v1",
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
        model: "mimo-v2.5:policy-v1",
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
      model: "mimo-v2.5:policy-v1",
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
      model: "mimo-v2.5:policy-v1",
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
      model: "mimo-v2.5:policy-v1",
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

describe("annual note recap", () => {
  it("builds recap context from titles and firsts with dated placeholders, never record bodies", () => {
    const records = [
      { title: "第一次挥手", text: "她在餐椅上挥了挥手。", first: true, date: "2026-09-20T12:00:00" },
      { title: "", text: "公园里走了很远\n下午睡得很沉", first: false, date: "2026-09-21T12:00:00" },
    ];
    const context = recapContext(records, "已写的话");
    expect(context).toContain("第一次：第一次挥手");
    expect(context).toContain("（无标题）· 2026年9月21日");
    expect(context).not.toContain("公园里走了很远");
    expect(context).not.toContain("下午睡得很沉");
    expect(context).not.toContain("她在餐椅上挥了挥手。");
    expect(context).toContain("已写的寄语");
    expect(context.length).toBeLessThanOrEqual(3800);
    expect(recapContext(records)).not.toContain("已写的寄语");
  });
  it("excludes sensitive body text even from untitled firsts while keeping the existing note", () => {
    const records = [{ title: "  ", text: "敏感病历：只留在本机", first: true, date: "2026-09-21T12:00:00" }];
    const context = recapContext(records, "你已经听过的家里话");
    expect(context).not.toContain("敏感病历");
    expect(context).not.toContain("只留在本机");
    expect(context).toContain("第一次：（无标题）· 2026年9月21日");
    expect(context).toContain("你已经听过的家里话");
    const capped = recapContext(records, "字".repeat(500) + "超出部分");
    expect(capped).toContain("字".repeat(500));
    expect(capped).not.toContain("超出部分");
  });
  it("accepts stored recap jobs beside generate and polish", () => {
    const { library, draft } = fixture();
    const fingerprint = sourceFingerprint(draft, library.media);
    draft.aiJob = {
      fingerprint,
      kind: "write",
      eventIndex: 0,
      model: "x",
      writingMode: "recap",
      steps: [],
    };
    const restored = JSON.parse(JSON.stringify(library));
    validateLibrary(restored);
    (restored.drafts.draft!.aiJob as { writingMode?: string }).writingMode =
      "recap-up";
    expect(() => validateLibrary(restored)).toThrow();
  });
});

describe("retry guidance after failures", () => {
  it("keeps retrying the original request after recoverable errors", () => {
    for (const code of ["NETWORK", "CANCELED", "QUOTA_EXCEEDED", null])
      expect(retryPlan(code).retryOriginal).toBe(true);
  });
  it("only offers regeneration once the server retired the request", () => {
    const plan = retryPlan("RESULT_EXPIRED");
    expect(plan.retryOriginal).toBe(false);
    expect(plan.notice).toContain("重新生成");
  });
});
const recentInterviewRecords = Array.from({ length: 12 }, (_, i) => ({
  title: `${i}号标题${"题".repeat(50)}`, date: `2026-09-${String(i + 1).padStart(2, "0")}`,
  text: "别的记录的秘密正文", photos: ["秘密照片"],
}));
describe("interviewer contexts", () => {
  it("asks about this draft, signature and age with only ten short recent titles", () => {
    const context = askContext({ by: "爸爸", ageLabel: "4 个月", date: "2026-09-05", title: "第一次翻身", text: "当前草稿", first: false, recent: recentInterviewRecords });
    expect(context).toContain("落款：爸爸\n她的月龄：4 个月\n记录日期：2026-09-05\n已标第一次：否\n标题：第一次翻身\n正文：\n当前草稿");
    expect(context).toContain(recentInterviewRecords[0]!.title.slice(0, 40));
    expect(context).not.toContain(recentInterviewRecords[0]!.title.slice(0, 41));
    expect(context).not.toContain("2026-09-11");
    expect(context).not.toContain("秘密");
  });
  it("bounds long draft and overall context, preserving the clipping explanation", () => {
    const context = askContext({ by: "爸".repeat(20), ageLabel: "月".repeat(40), date: "2026-09-05", title: "题".repeat(200), text: "文".repeat(5000), first: true, recent: recentInterviewRecords });
    expect(context.length).toBeLessThanOrEqual(3800);
    expect(context).toContain("（正文较长，只送前 3000 字）");
    expect(context).toContain("已标第一次：是");
    expect(context.match(/文/g)!.length).toBeLessThanOrEqual(3002);
  });
  it("handles unknown age and caps recent questions without other bodies or photos", () => {
    const context = questionContext({ ageLabel: null, today: "2026-09-05", recent: recentInterviewRecords, asked: Array.from({ length: 10 }, (_, i) => `问题${i}${"问".repeat(100)}`) });
    expect(context).toContain("她的月龄：（未填写或尚未出生）");
    expect(context).toContain("今天日期：2026-09-05");
    expect(context).not.toContain("问题2");
    expect(context).toContain("问题9");
    expect(context).not.toContain("2026-09-11");
    expect(context).not.toContain("秘密");
    expect(context.length).toBeLessThanOrEqual(2000);
    expect(askContext({ ageLabel: null, date: "2026-09-05", title: "", text: "", first: false, recent: [] })).toContain("（未填写或尚未出生）");
  });
  it("guides empty and long letters with signature and opening date", () => {
    const input = { by: "妈妈", ageLabel: null, openAt: "2044-09-05", draft: "  " };
    expect(letterContext(input)).toBe("落款：妈妈\n她的月龄：（未填写或尚未出生）\n拆封日期：2044-09-05\n当前草稿：\n（还没写）");
    expect(letterContext({ ...input, by: "爸".repeat(50) })).toContain(`落款：${"爸".repeat(50)}\n`);
    expect(letterContext({ ...input, ageLabel: "4 个月", draft: "文".repeat(3000) }).split("当前草稿：\n")[1]).toHaveLength(2000);
  });
  it("adds signature and quotes while preserving old output byte for byte", () => {
    expect(polishRequest({ title: " 标题 ", text: "正文" }).context).toBe("标题：标题\n正文：\n正文");
    expect(polishRequest({ by: "爸爸", title: " 标题 ", text: "正文" }).context).toBe("落款：爸爸\n标题：标题\n正文：\n正文");
    expect(writeContext("write", { title: "标题", text: "正文" }).context).toBe("标题\n正文");
    expect(writeContext("write", { by: "妈妈", title: "标题", text: "正文" }).context).toBe("落款：妈妈\n标题\n正文");
    expect(writeContext("group", { by: "爸爸", text: "正文" }).context).toBe("");
    const records = [{ title: "翻身", date: "2026-09-05", first: true }];
    expect(recapContext(records, "寄语")).toBe("这一年共有 1 条记录。\n第一次：翻身\n记录标题：\n翻身\n已写的寄语（仅参考语气与已覆盖内容，不要重复）：\n寄语");
    const quotes = Array.from({ length: 22 }, (_, i) => `第${i}句${"话".repeat(80)}`);
    const recap = recapContext(records, "寄语", quotes);
    expect(recap).toContain(`第一次：翻身\n她说的话：${quotes[0]!.slice(0, 60)}`);
    expect(recap).not.toContain(quotes[0]!.slice(0, 61));
    expect(recap).not.toContain("第20句");
  });
});
describe("daily question memory", () => {
  it("uses today's cache first and never retries a failed attempt the same day", () => {
    expect(questionPlan(undefined, "2026-09-21")).toBe("request");
    const failed = rememberQuestion(undefined, "2026-09-21", null);
    expect(questionPlan(failed, "2026-09-21")).toBe("fallback");
    const success = rememberQuestion(failed, "2026-09-21", "她今天说什么？");
    expect(questionPlan(success, "2026-09-21")).toBe("cached");
    expect(questionPlan(success, "2026-09-22")).toBe("request");
  });
  it("keeps only the last seven calendar days and at most seven questions", () => {
    const cache = { requestedDay: "2026-09-20", asked: Array.from({ length: 14 }, (_, i) => ({ day: `2026-09-${String(i + 8).padStart(2, "0")}`, question: `问题${i}` })) };
    const next = rememberQuestion(cache, "2026-09-21", "今天的问题");
    expect(next.asked.map((q) => q.day)).toEqual(["2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21"]);
    expect(next.asked[6]!.question).toBe("今天的问题");
    expect(rememberQuestion(next, "2026-10-01", null).asked).toEqual([]);
  });
});
describe("interviewer response validation", () => {
  it.each([
    ["ask", { questions: ["谁在旁边？"], first: false }],
    ["ask", { questions: ["一", "二", "三"], first: true }],
    ["question", { question: "她今天说了什么？" }],
    ["letter", { questions: ["一", "二"] }],
    ["letter", { questions: ["一", "二", "三"] }],
  ] as const)("accepts %s", (mode, result) => {
    expect(validateResult(result, "write", [], mode)).toEqual(result);
  });
  it.each([
    ["ask", null], ["ask", { questions: ["一"] }], ["ask", { questions: [], first: true }],
    ["ask", { questions: ["一"], first: "true" }], ["ask", { questions: ["一", "二", "三", "四"], first: true }],
    ["question", { question: " " }], ["question", { question: "问".repeat(31) }], ["question", { question: 1 }],
    ["letter", { questions: ["一"] }], ["letter", { questions: ["一", null] }],
    ["letter", { questions: ["一", " "] }], ["letter", { questions: ["一", "问".repeat(31)] }],
  ] as const)("rejects invalid %s", (mode, result) => {
    expect(() => validateResult(result, "write", [], mode)).toThrow(AIError);
    expect(() => validateResult(result, "write", [], mode)).toThrow("AI 问得不合规矩，请重试。");
  });
  it.each(["ask", "question", "letter", "editor"])("recognizes stored %s jobs", (writingMode) => {
    expect(validateStoredAI({ fingerprint: "a".repeat(64), kind: "write", eventIndex: 0, model: "model", writingMode, steps: [] })).toBe(true);
  });
});

const editorRecord = (id: string, patch: Partial<LocalRecord> = {}): LocalRecord => ({
  ...emptyContent(), id, revision: 1, date: "2026-09-10T12:00:00", updatedAt: "2026-09-21T10:00:00Z",
  title: "窗边的小脚", text: "她说窗边有风。温馨。" + "字".repeat(40), ...patch,
});
const editorRecords = () => [editorRecord("r1"), editorRecord("r2"), editorRecord("r3", { date: "2026-10-10T12:00:00", text: "窗边有风。" })];
const editorResult = () => ({
  requestId: "00000000-0000-4000-8000-000000000001", model: "test-model", title: "窗边的小脚",
  chapters: [
    { month: "2026-09", picks: ["r1"], quote: { recordId: "r1", text: "窗边有风。" } },
    { month: "2026-10", picks: ["r3"], quote: { recordId: "r3", text: "窗边有风。" } },
  ], notes: "每月选一段。",
});
describe("editor context privacy and limits", () => {
  it("projects only this year's allowed text fields and booleans in local date order", () => {
    const { library } = fixture();
    const records = [editorRecord("r2", { by: "爸爸", quote: true, first: true, mediaIds: ["a"] }),
      editorRecord("r1", { date: "2026-01-01T12:00:00", title: "题".repeat(110) }),
      editorRecord("old", { date: "2025-12-30T12:00:00", text: "OTHER_YEAR_SECRET" })];
    const context = editorContext("2026", records, library.media);
    const parsed = JSON.parse(context);
    expect(Object.keys(parsed).sort()).toEqual(["records", "year"]);
    expect(parsed.records.map((r: { id: string }) => r.id)).toEqual(["r1", "r2"]);
    expect(parsed.records[0].date).toBe("2026-01-01");
    expect(parsed.records[0].title).toHaveLength(100);
    expect(parsed.records[0].photos).toBe(false);
    expect(parsed.records[0].quote).toBe(false);
    expect(parsed.records[0]).not.toHaveProperty("by");
    expect(Object.keys(parsed.records[1]).sort()).toEqual(["by", "date", "first", "id", "photos", "quote", "text", "title"]);
    expect(parsed.records[1]).toMatchObject({ by: "爸爸", first: true, quote: true, photos: true });
    for (const secret of ["OTHER_YEAR_SECRET", "a.jpg", "sha256", "location", "mediaIds", "image", "base64"]) expect(context).not.toContain(secret);
    expect(records[0]!.id).toBe("r2");
  });
  it("caps at the newest 400 records, preserving ascending date order", () => {
    const records = Array.from({ length: 401 }, (_, i) => editorRecord(`r${String(i).padStart(3, "0")}`, { text: "", title: "" }));
    const parsed = JSON.parse(editorContext("2026", records.reverse(), {}));
    expect(parsed.records).toHaveLength(400);
    expect(parsed.records[0].id).toBe("r001");
    expect(parsed.records[399].id).toBe("r400");
  });
  it.each([[1, 4000], [20, 1500], [50, 600], [100, 200]])("clips %i long records to %i characters including the ellipsis", (count, limit) => {
    const records = Array.from({ length: count }, (_, i) => editorRecord(`r${i}`, { text: "字".repeat(5000) }));
    const context = editorContext("2026", records, {}), parsed = JSON.parse(context);
    expect(context.length).toBeLessThanOrEqual(60000);
    expect(parsed.records[0].text).toBe("字".repeat(limit - 1) + "…");
    expect(records[0]!.text).toHaveLength(5000);
  });
  it("counts JSON escape bytes as characters and reports a remaining overflow", () => {
    const records = Array.from({ length: 400 }, (_, i) => editorRecord(`r${i}`, { text: "\n".repeat(4000) }));
    expect(() => editorContext("2026", records, {})).toThrow(new AIError("INVALID_INPUT", "这一年的记录太多，AI 暂时帮不了。"));
    expect(() => editorContext("2025", editorRecords(), {})).toThrow(AIError);
  });
});
describe("editor result contract", () => {
  it("accepts grounded picks, a quote from an unpicked record, trimmed original quotes and Unicode limits", () => {
    const result = editorResult();
    result.chapters[0]!.picks = ["r2"];
    result.chapters[0]!.quote.text = " 温馨 ";
    const picks = checkEditorResult(result, "2026", editorRecords());
    expect(picks.months["2026-09"]).toEqual({ recordIds: ["r2"], quote: { recordId: "r1", text: "温馨" } });
    expect(Number.isFinite(Date.parse(picks.updatedAt))).toBe(true);
    const unicode = { title: "𠮷".repeat(4), chapters: [{ month: "2026-09", picks: ["r1"] }], notes: "字".repeat(200) };
    expect(checkEditorResult(unicode, "2026", editorRecords()).title).toBe(unicode.title);
    result.chapters[0]!.quote.text = "字".repeat(40);
    expect(checkEditorResult(result, "2026", editorRecords()).months["2026-09"]!.quote!.text).toHaveLength(40);
    result.chapters[0]!.quote.text = "窗边的小脚";
    expect(() => checkEditorResult(result, "2026", editorRecords())).not.toThrow();
  });
  const bad: Record<string, (v: ReturnType<typeof editorResult>) => void> = {
    unknown: v => { v.chapters[0]!.picks = ["missing"]; },
    duplicate: v => { v.chapters[0]!.picks = ["r1", "r1"]; },
    crossChapterDuplicate: v => { v.chapters[1]!.picks = ["r1"]; },
    crossMonth: v => { v.chapters[0]!.picks = ["r3"]; },
    fourPicks: v => { v.chapters[0]!.picks = ["r1", "r2", "r4", "r5"]; },
    emptyPicks: v => { v.chapters[0]!.picks = []; },
    inventedQuote: v => { v.chapters[0]!.quote.text = "不在原文里"; },
    longQuote: v => { v.chapters[0]!.quote.text = "字".repeat(41); },
    blankQuote: v => { v.chapters[0]!.quote.text = " "; },
    unknownQuote: v => { v.chapters[0]!.quote.recordId = "missing"; },
    crossMonthQuote: v => { v.chapters[0]!.quote.recordId = "r3"; },
    shortTitle: v => { v.title = "三个字"; },
    longTitle: v => { v.title = "字".repeat(9); },
    bannedTitle: v => { v.title = "温馨的一年"; },
    bannedNotes: v => { v.notes = "这些很珍贵"; },
    longNotes: v => { v.notes = "字".repeat(201); },
    wrongYear: v => { v.chapters[0]!.month = "2025-09"; },
    invalidMonth: v => { v.chapters[0]!.month = "2026-13"; },
    repeatedMonth: v => { v.chapters.push(structuredClone(v.chapters[0]!)); },
    noChapters: v => { v.chapters = []; },
    unknownKey: v => { Object.assign(v, { text: "unexpected" }); },
    unknownChapterKey: v => { Object.assign(v.chapters[0]!, { extra: true }); },
    unknownQuoteKey: v => { Object.assign(v.chapters[0]!.quote, { extra: true }); },
  };
  it.each(Object.keys(bad))("rejects %s with the specific AI error", (key) => {
    const result = editorResult(); bad[key]!(result);
    try { checkEditorResult(result, "2026", editorRecords()); throw new Error("unexpected success"); }
    catch (e) { expect(e).toMatchObject({ code: "INVALID_RESULT", message: "AI 的目录建议不合规矩，请重试。" }); }
  });
  it.each([null, [], {}, { title: 1 }, { title: "窗边的小脚", chapters: [null], notes: "" }])("rejects malformed response %j", (value) => {
    expect(() => checkEditorResult(value, "2026", editorRecords())).toThrow(AIError);
  });
});
describe("applyYearPicks checks the current originals", () => {
  it("drops removed/moved records and changed quotes, keeps order and leaves the saved directory alone", () => {
    const picks: YearPicks = { months: {
      "2026-09": { recordIds: ["r2", "gone", "r1"], quote: { recordId: "r1", text: "旧话" } },
      "2026-10": { recordIds: ["moved"], quote: { recordId: "gone", text: "原话" } },
    }, updatedAt: "2026-09-21T10:00:00Z" };
    const before = structuredClone(picks);
    expect(applyYearPicks(picks, [...editorRecords(), editorRecord("moved")])).toEqual({
      months: { "2026-09": { recordIds: ["r2", "r1"] } }, droppedRecords: 2, droppedQuotes: 2,
    });
    expect(picks).toEqual(before);
    expect(applyYearPicks(undefined, editorRecords())).toBeUndefined();
  });
  it("retains an exact quote from an unpicked record's title and removes a now-empty month", () => {
    const picks = checkEditorResult(editorResult(), "2026", editorRecords());
    picks.months["2026-09"]!.quote = { recordId: "r2", text: "窗边的小脚" };
    expect(applyYearPicks(picks, editorRecords())!.months).toEqual(picks.months);
    expect(applyYearPicks(picks, [])).toEqual({ months: {}, droppedRecords: 2, droppedQuotes: 2 });
  });
});
