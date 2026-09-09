import type { AiSettings, OrganizerCapability } from "../ai/types";
import type { DraftContent } from "./model";
import { aiJobFailureMessage } from "../ai/job-messages";
import { formatOccurredLabel } from "../utils/occurred-precision";

export type CaptureProcessing = { state: "queued"; jobId: string } | { state: "skipped"; reason: string };

export function captureSavedMessage(processing?: CaptureProcessing): string {
  if (processing?.state === "queued") return "已保存，整理已排队。可以离开页面，稍后回来查看建议。";
  if (!processing || ["not_requested", "private_content", "already_saved"].includes(processing.reason)) return "已保存为一条记忆，随时可以查看和补充。";
  return `记忆和原件已保存，AI 暂未开始。${aiJobFailureMessage(processing.reason)}`;
}

/** Only the untouched empty default can use metadata/unknown at publication. */
export function canInferCaptureTime(content: Pick<DraftContent, "occurredAt" | "occurredAtPrecision">): boolean {
  return content.occurredAt === null && content.occurredAtPrecision === "exact";
}

export function captureDateSummary(content: Pick<DraftContent, "occurredAt" | "occurredAtPrecision">, edited: boolean | undefined, timezone: string): string {
  if (canInferCaptureTime(content) && !edited) return "日期自动读取，信息可以稍后补充。";
  if (content.occurredAtPrecision === "unknown") return "时间不确定，可以稍后补充。";
  if (!content.occurredAt) return "尚未填完日期，也可以选择时间不确定。";
  return formatOccurredLabel(content.occurredAtPrecision, content.occurredAt, timezone);
}

/** The combined button is an explicit request for this memory's selected media.
 * It never enables consent, changes audience, or enrolls future uploads. */
export function captureOrganizerAvailability(settings: AiSettings | null, visibility: DraftContent["visibility"], mimeTypes: string[]): { ready: boolean; message: string } {
  if (visibility !== "family") return { ready: false, message: "按所选读者保存；需要 AI 时，可在记忆中单独选择整理。" };
  if (mimeTypes.length > 10) return { ready: false, message: "素材可以一起保存；AI 每次最多整理 10 份，可以稍后分批选择。" };
  if (!settings?.configured) return { ready: false, message: "AI 尚未配置或暂不可用，可以直接保存，稍后再整理。" };
  const required = new Set<OrganizerCapability>(["text"]);
  for (const mime of mimeTypes) {
    if (mime.startsWith("image/") || mime.startsWith("video/")) required.add("vision");
    if (mime.startsWith("audio/")) required.add("transcription");
    if (!mime) return { ready: false, message: "正在读取素材信息，可以先保存。" };
  }
  const capabilities = [...required].map(kind => settings.capabilities.find(row => row.capability === kind));
  if (capabilities.some(row => !row?.available)) return { ready: false, message: "所需的 AI 模型尚未配齐，可以直接保存，稍后再整理。" };
  if (capabilities.some(row => !row?.consented)) return { ready: false, message: "AI 尚未获得处理授权，可以直接保存；管理员可在 AI 设置中开启。" };
  return { ready: true, message: "保存并整理会将本次文字和素材发送给已授权的 AI，后台看图、转录并生成建议，你可以稍后确认。" };
}
