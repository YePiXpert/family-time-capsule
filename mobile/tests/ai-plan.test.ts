import { describe, it, expect } from "vitest";
import { emptyLibrary, type Library } from "../src/local/model";
import { retryPlan } from "../src/ai/state";
import {
  AI_MODEL,
  assertGenerateInput,
  batchProgress,
  expectedPhotoIds,
  groupedWriteContext,
  matchesCurrentView,
  pendingOtherProposal,
  planGroupDays,
  planStep,
  reuseJob,
  runSpec,
  successProgress,
  writeContext,
} from "../src/ai/plan";
import type { AIJob, AIProposal } from "../src/ai/types";

function mediaOf(entries: [string, string | undefined][]): Library["media"] {
  const library = emptyLibrary();
  for (const [id, capturedAt] of entries)
    library.media[id] = {
      id,
      file: `${id}.jpg`,
      kind: "image",
      name: `${id}.jpg`,
      bytes: 1,
      sha256: id.padEnd(64, "0").slice(0, 64),
      photoMetadata: capturedAt ? { capturedAt } : {},
    };
  return library.media;
}
const spec = runSpec("f".repeat(64), "write", 0, "generate");
const storedJob: AIJob = {
  ...spec,
  steps: [
    { key: "write", requestId: "r1", result: { title: "标题", text: "正文" } },
  ],
};
const writeProposal = (writingMode?: "polish"): AIProposal => ({
  fingerprint: "f".repeat(64),
  kind: "write",
  eventIndex: 0,
  model: AI_MODEL,
  writingMode,
  title: "标题",
  text: "正文",
});

describe("AI editor plan: batching", () => {
  it("plans nothing without photos and one batch for a day under the limit", () => {
    const media = mediaOf([
      ["a", "2020-01-01T08:00:00"],
      ["b", "2020-01-01T09:00:00"],
    ]);
    expect(planGroupDays([], media)).toEqual([]);
    expect(planGroupDays(["a"], media)).toEqual([
      {
        day: "2020-01-01",
        chunks: [{ key: "2020-01-01-0", photoIds: ["a"] }],
        mergeKey: null,
      },
    ]);
    const twenty = Array.from(
      { length: 20 },
      (_, i): [string, string] => [
        `n${i}`,
        `2020-01-03T12:${String(i).padStart(2, "0")}:00`,
      ],
    );
    const ids = twenty.map(([id]) => id);
    expect(planGroupDays(ids, mediaOf(twenty))).toEqual([
      {
        day: "2020-01-03",
        chunks: [{ key: "2020-01-03-0", photoIds: ids }],
        mergeKey: null,
      },
    ]);
  });
  it("splits oversized days into 20-photo chunks with one merge, keys intact", () => {
    const entries = Array.from(
      { length: 45 },
      (_, i): [string, string] => [
        `p${i}`,
        `2020-01-01T12:${String(i).padStart(2, "0")}:00`,
      ],
    );
    const ids = entries.map(([id]) => id);
    const plan = planGroupDays(ids, mediaOf(entries));
    expect(plan.map((day) => day.chunks.map((c) => c.photoIds.length))).toEqual(
      [[20, 20, 5]],
    );
    expect(plan[0]!.mergeKey).toBe("merge-2020-01-01");
    expect(plan[0]!.chunks.map((c) => c.key)).toEqual([
      "2020-01-01-0",
      "2020-01-01-1",
      "2020-01-01-2",
    ]);
    expect(plan[0]!.chunks.flatMap((c) => c.photoIds)).toEqual(ids);
    const twentyOne = entries.slice(0, 21);
    const remainder = planGroupDays(
      twentyOne.map(([id]) => id),
      mediaOf(twentyOne),
    );
    expect(remainder[0]!.chunks.map((c) => c.photoIds.length)).toEqual([
      20,
      1,
    ]);
    expect(remainder[0]!.mergeKey).toBe("merge-2020-01-01");
  });
  it("keeps days apart in arrival order, buckets undated photos, sorts by time", () => {
    const media = mediaOf([
      ["late", "2020-01-05T20:00:00"],
      ["early", "2020-01-05T08:00:00"],
      ["other", "2020-01-02T10:00:00"],
      ["undated", undefined],
    ]);
    expect(
      planGroupDays(["late", "early"], media)[0]!.chunks[0]!.photoIds,
    ).toEqual(["early", "late"]);
    const plan = planGroupDays(["late", "other", "undated", "early"], media);
    expect(plan.map((day) => day.day)).toEqual([
      "2020-01-05",
      "2020-01-02",
      "undated",
    ]);
    expect(plan.map((day) => day.mergeKey)).toEqual([null, null, null]);
  });
});

describe("AI editor plan: job identity and reuse", () => {
  it("stamps write specs with the mode and group specs without one", () => {
    expect(AI_MODEL).toBe("deepseek-flash:high");
    expect(runSpec("f".repeat(64), "group", 0, "generate")).toEqual({
      fingerprint: "f".repeat(64),
      kind: "group",
      eventIndex: 0,
      model: AI_MODEL,
    });
    expect(runSpec("f".repeat(64), "write", 2, "polish")).toEqual({
      fingerprint: "f".repeat(64),
      kind: "write",
      eventIndex: 2,
      model: AI_MODEL,
      writingMode: "polish",
    });
  });
  it("reuses the stored job only when fingerprint, task, event, model and mode match", () => {
    const reused = reuseJob(storedJob, spec, false);
    expect(reused).toEqual(storedJob);
    reused.steps[0]!.result = { title: "改", text: "改" };
    expect(storedJob.steps[0]!.result).toEqual({ title: "标题", text: "正文" });
    for (const different of [
      runSpec("a".repeat(64), "write", 0, "generate"),
      runSpec("f".repeat(64), "group", 0, "generate"),
      runSpec("f".repeat(64), "write", 1, "generate"),
      runSpec("f".repeat(64), "write", 0, "polish"),
      runSpec("f".repeat(64), "write", 0, "recap"),
    ])
      expect(reuseJob(storedJob, different, false).steps).toEqual([]);
    expect(reuseJob(storedJob, spec, true).steps).toEqual([]);
    expect(reuseJob(undefined, spec, false).steps).toEqual([]);
    expect(
      reuseJob({ ...spec, writingMode: undefined, steps: [] }, spec, false),
    ).toEqual({ ...spec, writingMode: undefined, steps: [] });
  });
});

describe("AI editor plan: step cache and request ids", () => {
  it("reuses finished results, retries unfinished steps by their id, mints only new ones", () => {
    const job: AIJob = {
      ...spec,
      steps: [
        { key: "done", requestId: "r1", result: { title: "t", text: "x" } },
        { key: "half", requestId: "r2" },
      ],
    };
    let minted = 0;
    const mint = () => `new-${++minted}`;
    const cached = planStep(job, "done", mint);
    expect(cached.created).toBe(false);
    expect(cached.result).toEqual({ title: "t", text: "x" });
    const retry = planStep(job, "half", mint);
    expect(retry.created).toBe(false);
    expect(retry.result).toBeUndefined();
    expect(retry.step.requestId).toBe("r2");
    const created = planStep(job, "fresh", mint);
    expect(created.created).toBe(true);
    expect(created.result).toBeUndefined();
    expect(created.step).toEqual({ key: "fresh", requestId: "new-1" });
    expect(job.steps).toHaveLength(3);
    expect(job.steps[2]).toBe(created.step);
    expect(minted).toBe(1);
  });
});

describe("AI editor plan: pre-flight validation", () => {
  it("refuses grouping saved records before counting photos, and groups under two", () => {
    expect(() =>
      assertGenerateInput("group", "generate", [], "rec-1", {}),
    ).toThrow("调整归属");
    expect(() =>
      assertGenerateInput("group", "generate", [], null, {}),
    ).toThrow("按事情分组至少需要两张照片，先再多选几张。");
    expect(
      assertGenerateInput("group", "generate", ["a", "b"], null, {}),
    ).toBeUndefined();
  });
  it("reuses the polish request rules verbatim", () => {
    expect(() =>
      assertGenerateInput("write", "polish", [], null, {
        title: "题",
        text: "  ",
      }),
    ).toThrow("还没有可润色的正文");
    expect(() =>
      assertGenerateInput("write", "polish", [], null, {
        title: "题",
        text: "长".repeat(2001),
      }),
    ).toThrow("2000");
    expect(
      assertGenerateInput("write", "polish", [], null, {
        title: "题",
        text: "文",
      }),
    ).toBeUndefined();
  });
  it("bounds generation between one and one hundred photos", () => {
    expect(() =>
      assertGenerateInput("write", "generate", [], null, {}),
    ).toThrow("这件事还没有照片");
    const many = Array.from({ length: 101 }, (_, i) => `p${i}`);
    expect(() =>
      assertGenerateInput("write", "generate", many, null, {}),
    ).toThrow("一次最多整理 100 张照片，请分几份草稿处理。");
    expect(
      assertGenerateInput("write", "generate", many.slice(0, 100), null, {}),
    ).toBeUndefined();
  });
});

describe("AI editor plan: write context and clipping notices", () => {
  it("sends the chosen event's title and body, empty for grouping", () => {
    expect(writeContext("write", { title: "标题", text: "正文" }).context).toBe(
      "标题\n正文",
    );
    expect(writeContext("write", { text: "只有正文" }).context).toBe(
      "只有正文",
    );
    expect(writeContext("write", {}).context).toBe("");
    expect(writeContext("group", { title: "标题", text: "正文" }).context).toBe(
      "",
    );
    const long = writeContext("write", { text: "长".repeat(3500) });
    expect(long.context).toBe("长".repeat(3500));
    expect(long.clipped(3500)).toBe("");
    expect(long.clipped(1500)).toBe(
      "正文较长，本次只把前 1500 字发给 AI，本机内容不变。",
    );
    const over = writeContext("write", { text: "长".repeat(3501) });
    expect(over.clipped(3500)).toBe(
      "正文较长，本次只把前 3500 字发给 AI，本机内容不变。",
    );
  });
  it("measures the clip against the full text, including the title line", () => {
    expect(
      writeContext("write", { title: "标题", text: "正文" }).clipped(4),
    ).toBe("正文较长，本次只把前 4 字发给 AI，本机内容不变。");
    expect(writeContext("write", { title: "题", text: "文" }).clipped(3)).toBe(
      "",
    );
  });
});

describe("AI editor plan: grouped write context", () => {
  it("caps the body at 1500 and each summary at 100 characters", () => {
    const context = groupedWriteContext("文".repeat(2000), [
      { title: "上午", summary: "细".repeat(150), photoIds: ["a"] },
      { title: "下午", summary: "短", photoIds: ["b"] },
    ]);
    const [body, summaries] = context.split("照片分析摘要（仅作参考）：\n");
    expect(body).toBe("文".repeat(1500) + "\n");
    expect(summaries).toBe(`上午：${"细".repeat(100)}\n下午：短`);
  });
  it("caps the combined summaries at 2000 characters", () => {
    const groups = Array.from({ length: 30 }, (_, i) => ({
      title: `事${i}`,
      summary: "s".repeat(100),
      photoIds: [`p${i}`],
    }));
    expect(groupedWriteContext("", groups)).toHaveLength(
      "\n照片分析摘要（仅作参考）：\n".length + 2000,
    );
  });
});

describe("AI editor plan: response expectations and progress copy", () => {
  it("expects merge responses to cover the pre-merge groups, others their photos", () => {
    expect(
      expectedPhotoIds(["z"], {
        mode: "merge",
        groups: [
          { photoIds: ["a"], title: "x", summary: "y" },
          { photoIds: ["b", "c"], title: "x", summary: "y" },
        ],
      }),
    ).toEqual(["a", "b", "c"]);
    expect(expectedPhotoIds(["z", "a"], {})).toEqual(["z", "a"]);
    expect(expectedPhotoIds(["z"], { context: "c" })).toEqual(["z"]);
  });
  it("ships the exact batch and success progress strings", () => {
    expect(batchProgress(1, 7)).toBe("正在分析第 1/7 批照片…");
    expect(batchProgress(21, 21)).toBe("正在分析第 21/21 批照片…");
    expect(successProgress("group", "generate")).toBe(
      "分组建议已保存，核对后确认。",
    );
    expect(successProgress("group", "polish")).toBe(
      "分组建议已保存，核对后确认。",
    );
    expect(successProgress("write", "polish")).toBe(
      "润色结果已保存，与原文对照后采用。",
    );
    expect(successProgress("write", "generate")).toBe(
      "建议已保存，请预览后采用。",
    );
  });
});

describe("AI editor plan: which proposal the panel is showing", () => {
  const groupProposal: AIProposal = {
    fingerprint: "f".repeat(64),
    kind: "group",
    eventIndex: 0,
    model: AI_MODEL,
    groups: [],
  };
  it("matches the selected task, treating a missing mode as generate", () => {
    expect(matchesCurrentView(groupProposal, "group", "generate")).toBe(true);
    expect(pendingOtherProposal(groupProposal, "group", "generate")).toBe(
      false,
    );
    expect(matchesCurrentView(writeProposal(), "write", "generate")).toBe(true);
    expect(matchesCurrentView(writeProposal(undefined), "write", "generate")).toBe(true);
    expect(matchesCurrentView(writeProposal("polish"), "write", "polish")).toBe(
      true,
    );
  });
  it("flags the proposal belonging to the other task or mode as pending", () => {
    expect(matchesCurrentView(groupProposal, "write", "generate")).toBe(false);
    expect(pendingOtherProposal(groupProposal, "write", "generate")).toBe(true);
    expect(
      matchesCurrentView(writeProposal("polish"), "write", "generate"),
    ).toBe(false);
    expect(
      pendingOtherProposal(writeProposal("polish"), "write", "generate"),
    ).toBe(true);
    expect(matchesCurrentView(writeProposal(), "group", "generate")).toBe(
      false,
    );
    expect(pendingOtherProposal(writeProposal(), "group", "generate")).toBe(
      true,
    );
    expect(matchesCurrentView(undefined, "write", "generate")).toBe(false);
    expect(pendingOtherProposal(undefined, "write", "generate")).toBe(false);
  });
});

describe("AI editor plan: retry classification", () => {
  it("keeps retry-same-request for every error code except retired results", () => {
    for (const code of [
      "NETWORK",
      "CANCELED",
      "SERVER_ERROR",
      "INVALID_RESULT",
      "QUOTA_EXCEEDED",
      "anything-else",
      null,
    ]) {
      expect(retryPlan(code).retryOriginal).toBe(true);
      expect(retryPlan(code).notice).toBe("");
    }
    expect(retryPlan("RESULT_EXPIRED")).toEqual({
      retryOriginal: false,
      notice: "这次请求已结束，结果无法恢复；点「重新生成」才会计入今日额度。",
    });
  });
});
