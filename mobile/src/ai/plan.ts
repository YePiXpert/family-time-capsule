import type { Library, RecordDraft } from "../local/model";
import { PHOTO_JOB_LIMIT, polishRequest, sameDayChunks, sameJob } from "./state";
import type {
  AIGroup,
  AIJob,
  AIProposal,
  AIResult,
  WritingMode,
} from "./types";
/** 当前生效的模型；换模型即换任务，旧的分步结果不再复用。 */
export const AI_MODEL = "deepseek-flash:high";
export type AIStep = AIJob["steps"][number];
export const modeOf = (value: {
  writingMode?: WritingMode;
}): WritingMode => value.writingMode ?? "generate";
/** 生成前的本机校验：参数不满足就直接失败，不发起请求。 */
export function assertGenerateInput(
  kind: "group" | "write",
  mode: WritingMode,
  ids: string[],
  recordId: RecordDraft["recordId"],
  event: { title?: string; text?: string },
): void {
  if (kind === "group") {
    if (recordId)
      throw new Error(
        "按事情分组只在整理新建草稿的照片时使用，已保存的记录请用「调整归属」。",
      );
    if (ids.length < 2)
      throw new Error("按事情分组至少需要两张照片，先再多选几张。");
  }
  if (kind === "write" && mode === "polish") {
    const request = polishRequest({
      title: event.title ?? "",
      text: event.text ?? "",
    });
    if (request.error) throw new Error(request.error);
  } else if (kind === "write") {
    if (!ids.length)
      throw new Error(
        "这件事还没有照片。先添加照片再生成，或写下文字后用「润色我的文字」。",
      );
    if (ids.length > PHOTO_JOB_LIMIT)
      throw new Error(`一次最多整理 ${PHOTO_JOB_LIMIT} 张照片，请分几份草稿处理。`);
  }
}
/** 任务与建议共用的身份：指纹、任务、模型；写任务再带写作模式。 */
export function runSpec(
  fingerprint: string,
  kind: "group" | "write",
  eventIndex: number,
  mode: WritingMode,
): Omit<AIJob, "steps"> {
  return {
    fingerprint,
    kind,
    eventIndex,
    model: AI_MODEL,
    ...(kind === "write" ? { writingMode: mode } : {}),
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
export type GroupDayPlan = {
  day: string;
  chunks: { key: string; photoIds: string[] }[];
  mergeKey: string | null;
};
/** 大批量路径的分批计划：每天最多 20 张一批，多批的一天再追加一次合并。 */
export function planGroupDays(
  ids: string[],
  media: Library["media"],
): GroupDayPlan[] {
  return sameDayChunks(ids, media).map(({ day, chunks }) => ({
    day,
    chunks: chunks.map((photoIds, index) => ({
      key: `${day}-${index}`,
      photoIds,
    })),
    mergeKey: chunks.length > 1 ? `merge-${day}` : null,
  }));
}
export const batchProgress = (done: number, total: number) =>
  `正在分析第 ${done}/${total} 批照片…`;
/** 只把前一段发给 AI，本机内容不变；超限必须说明，不静默截断。 */
export function writeContext(
  kind: "group" | "write",
  event: { title?: string; text?: string },
): { context: string; clipped: (limit: number) => string } {
  const rawWrite = [event.title, event.text].filter(Boolean).join("\n");
  return {
    context: kind === "write" ? rawWrite.slice(0, 3500) : "",
    clipped: (limit: number) =>
      rawWrite.length > limit
        ? `正文较长，本次只把前 ${limit} 字发给 AI，本机内容不变。`
        : "",
  };
}
/** 整组写记录的上下文：截断的正文加上分组摘要。 */
export function groupedWriteContext(
  context: string,
  groups: AIGroup[],
): string {
  const summaries = groups
    .map((g) => `${g.title}：${g.summary.slice(0, 100)}`)
    .join("\n")
    .slice(0, 2000);
  return `${context.slice(0, 1500)}\n照片分析摘要（仅作参考）：\n${summaries}`;
}
/** 校验返回结果时的期望照片集合：合并请求按合并前的分组计算。 */
export function expectedPhotoIds(
  photoIds: string[],
  extra: Record<string, unknown>,
): string[] {
  return extra.mode === "merge"
    ? (extra.groups as AIGroup[]).flatMap((g) => g.photoIds)
    : photoIds;
}
export function successProgress(
  kind: "group" | "write",
  mode: WritingMode,
): string {
  return kind === "group"
    ? "分组建议已保存，核对后确认。"
    : mode === "polish"
      ? "润色结果已保存，与原文对照后采用。"
      : "建议已保存，请预览后采用。";
}
/** 面板正在看的建议与待切换的另一份建议。 */
export function matchesCurrentView(
  proposal: AIProposal | undefined,
  task: "group" | "write",
  writeMode: WritingMode,
): boolean {
  return (
    !!proposal &&
    (proposal.kind === task
      ? task === "group" || modeOf(proposal) === writeMode
      : false)
  );
}
export function pendingOtherProposal(
  proposal: AIProposal | undefined,
  task: "group" | "write",
  writeMode: WritingMode,
): boolean {
  return (
    !!proposal &&
    (proposal.kind !== task ||
      (task === "write" && modeOf(proposal) !== writeMode))
  );
}
