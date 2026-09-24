import { describe, it, expect } from "vitest";
import { retryPlan } from "../src/ai/state";
import {
  AI_MODEL,
  assertGenerateInput,
  matchesCurrentView,
  pendingOtherProposal,
  planStep,
  reuseJob,
  runSpec,
  successProgress,
} from "../src/ai/plan";
import type { AIJob, AIProposal } from "../src/ai/types";

const spec = runSpec("f".repeat(64), "polish");
const storedJob: AIJob = {
  ...spec,
  steps: [
    { key: "write", requestId: "r1", result: { title: "标题", text: "正文" } },
  ],
};
const writeProposal = (writingMode: "polish" = "polish"): AIProposal => ({
  fingerprint: "f".repeat(64),
  kind: "write",
  eventIndex: 0,
  model: AI_MODEL,
  writingMode,
  title: "标题",
  text: "正文",
});

describe("AI editor plan: job identity and reuse", () => {
  it("stamps write specs with the required mode", () => {
    expect(AI_MODEL).toBe("mimo-v2.6-pro:policy-v1");
    expect(runSpec("f".repeat(64), "polish")).toEqual({
      fingerprint: "f".repeat(64),
      kind: "write",
      eventIndex: 0,
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
      runSpec("a".repeat(64), "polish"),
      { ...spec, eventIndex: 1 },
      { ...spec, model: "different-model" },
      { ...spec, model: "mimo-v2.5:policy-v1" },
      runSpec("f".repeat(64), "recap"),
    ])
      expect(reuseJob(storedJob, different, false).steps).toEqual([]);
    expect(reuseJob(storedJob, spec, true).steps).toEqual([]);
    expect(reuseJob(undefined, spec, false).steps).toEqual([]);
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
  it("reuses the polish request rules verbatim", () => {
    expect(() =>
      assertGenerateInput("polish", {
        title: "题",
        text: "  ",
      }),
    ).toThrow("还没有可润色的正文");
    expect(() =>
      assertGenerateInput("polish", {
        title: "题",
        text: "长".repeat(2001),
      }),
    ).toThrow("2000");
    expect(
      assertGenerateInput("polish", {
        title: "题",
        text: "文",
      }),
    ).toBeUndefined();
  });
});

describe("AI editor plan: retry classification", () => {
  it("keeps retry-same-request for every error code except retired or failed-on-server results", () => {
    for (const code of [
      "NETWORK",
      "CANCELED",
      "SERVER_ERROR",
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
    // 服务端已把这次记为失败、不会重跑：只给「重新生成」。
    for (const code of ["INVALID_RESULT", "UPSTREAM_UNAVAILABLE"])
      expect(retryPlan(code)).toEqual({
        retryOriginal: false,
        notice: "这次没有生成出来，不计今日额度；点「重新生成」再试一次。",
      });
  });
});

describe("AI editor plan: review state", () => {
  it("keeps a polish proposal pending while the interviewer is selected", () => {
    const proposal = writeProposal();
    expect(matchesCurrentView(proposal, "polish")).toBe(true);
    expect(pendingOtherProposal(proposal, "polish")).toBe(false);
    expect(matchesCurrentView(proposal, "ask")).toBe(false);
    expect(pendingOtherProposal(proposal, "ask")).toBe(true);
    expect(matchesCurrentView(undefined, "polish")).toBe(false);
    expect(pendingOtherProposal(undefined, "ask")).toBe(false);
    expect(successProgress("polish")).toBe("润色结果已保存，与原文对照后采用。");
  });
});
