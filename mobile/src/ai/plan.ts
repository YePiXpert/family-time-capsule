import { polishRequest, sameJob } from "./state";
import type {
  AIJob,
  AIProposal,
  AIResult,
  WritingMode,
} from "./types";
/** 当前生效的模型；换模型即换任务，旧的分步结果不再复用。 */
export const AI_MODEL = "mimo-v2.5:policy-v1";
export type AIStep = AIJob["steps"][number];
export const modeOf = (value: {
  writingMode: WritingMode;
}): WritingMode => value.writingMode;
/** 生成前的本机校验：参数不满足就直接失败，不发起请求。 */
export function assertGenerateInput(
  mode: WritingMode,
  event: { title?: string; text?: string; by?: string },
): void {
  if (mode === "polish") {
    const request = polishRequest({
      by: event.by,
      title: event.title ?? "",
      text: event.text ?? "",
    });
    if (request.error) throw new Error(request.error);
  }
}
/** 任务与建议共用的身份：指纹、模型与写作模式。 */
export function runSpec(
  fingerprint: string,
  mode: WritingMode,
): Omit<AIJob, "steps"> {
  return {
    fingerprint,
    kind: "write",
    eventIndex: 0,
    model: AI_MODEL,
    writingMode: mode,
  };
}
/** 身份一致且未强制刷新时沿用旧任务（连同分步缓存），否则另起空任务。 */
export function reuseJob(
  previous: AIJob | undefined,
  spec: Omit<AIJob, "steps">,
  fresh: boolean,
): AIJob {
  return !fresh && sameJob(previous, spec)
    ? JSON.parse(JSON.stringify(previous))
    : { ...spec, steps: [] };
}
/** 分步缓存：有结果直接复用；只有 requestId 的步骤按原请求重试；新步骤才领取新 ID。 */
export function planStep(
  job: AIJob,
  key: string,
  newRequestId: () => string,
): { step: AIStep; result?: AIResult; created: boolean } {
  const existing = job.steps.find((s) => s.key === key);
  if (existing?.result)
    return { step: existing, result: existing.result, created: false };
  if (existing) return { step: existing, created: false };
  const step = { key, requestId: newRequestId() };
  job.steps.push(step);
  return { step, created: true };
}
export function successProgress(
  mode: WritingMode,
): string {
  return mode === "polish"
    ? "润色结果已保存，与原文对照后采用。"
    : "建议已保存，请预览后采用。";
}
/** 面板正在看的建议与待切换的另一份建议。 */
export function matchesCurrentView(
  proposal: AIProposal | undefined,
  writeMode: WritingMode,
): boolean {
  return !!proposal && modeOf(proposal) === writeMode;
}
export function pendingOtherProposal(
  proposal: AIProposal | undefined,
  writeMode: WritingMode,
): boolean {
  return !!proposal && modeOf(proposal) !== writeMode;
}
