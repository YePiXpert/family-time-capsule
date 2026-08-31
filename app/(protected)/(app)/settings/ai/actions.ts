"use server";

import { revalidatePath } from "next/cache";
import { requireFamilyCapability } from "@/lib/authz/context";
import { AI_CAPABILITIES, type AiCapability } from "@/lib/ai/types";
import {
  enableAiProcessingConsent,
  requestAiJobCancellation,
  retryAiJob,
  revokeAiProcessingConsent,
} from "@/lib/ai/jobs";

export type AiSettingsFormState = {
  error?: string;
  success?: string;
};

function capability(value: FormDataEntryValue | null): AiCapability | null {
  return typeof value === "string" &&
    AI_CAPABILITIES.includes(value as AiCapability)
    ? (value as AiCapability)
    : null;
}

export async function enableAiConsentAction(
  _previous: AiSettingsFormState | undefined,
  formData: FormData,
): Promise<AiSettingsFormState> {
  const context = await requireFamilyCapability("ai:configure");
  const selected = capability(formData.get("capability"));
  if (!selected) return { error: "AI 能力类型无效。" };
  const result = enableAiProcessingConsent(context, {
    capability: selected,
    allowAutomaticFamilyContent:
      formData.get("allowAutomaticFamilyContent") === "yes",
  });
  if (!result.ok) {
    return {
      error:
        result.error === "forbidden"
          ? "你的管理员权限已经变化，本次没有保存。"
          : "当前 Provider 未配置这项能力，或配置无效。",
    };
  }
  revalidatePath("/settings/ai");
  return { success: "外部处理同意已保存。" };
}

export async function revokeAiConsentAction(
  _previous: AiSettingsFormState | undefined,
  formData: FormData,
): Promise<AiSettingsFormState> {
  const context = await requireFamilyCapability("ai:configure");
  const selected = capability(formData.get("capability"));
  if (!selected) return { error: "AI 能力类型无效。" };
  const result = revokeAiProcessingConsent(context, selected);
  if (!result.ok) {
    return {
      error:
        result.error === "forbidden"
          ? "你的管理员权限已经变化，本次没有保存。"
          : "这项外部处理同意已经关闭。",
    };
  }
  revalidatePath("/settings/ai");
  return { success: "外部处理已关闭；等待中的相关任务已取消。" };
}

export async function cancelAiJobAction(
  _previous: AiSettingsFormState | undefined,
  formData: FormData,
): Promise<AiSettingsFormState> {
  const context = await requireFamilyCapability("ai:review");
  const jobId = String(formData.get("jobId") ?? "");
  const result = requestAiJobCancellation(context, jobId);
  if (!result.ok) {
    return { error: "任务不存在，或你的权限已经变化。" };
  }
  revalidatePath("/settings/ai");
  return {
    success:
      result.status === "cancellation_requested"
        ? "已请求停止；正在进行的 Provider 调用返回后不会保存结果。"
        : result.status === "cancelled"
          ? "任务已取消。"
          : "任务已经结束。",
  };
}

export async function retryAiJobAction(
  _previous: AiSettingsFormState | undefined,
  formData: FormData,
): Promise<AiSettingsFormState> {
  const context = await requireFamilyCapability("ai:review");
  const jobId = String(formData.get("jobId") ?? "");
  const result = retryAiJob(context, jobId);
  if (!result.ok) {
    const error =
      result.error === "capability_not_consented"
        ? "请先由管理员重新确认当前 Provider 和 Model 的外部处理同意。"
        : result.error === "source_forbidden_or_not_found"
          ? "原始来源已不存在或当前不可见，不能重试。"
          : result.error === "automatic_restricted_content_forbidden"
            ? "特殊可见范围不能自动处理，请回到原内容逐项触发。"
            : result.error === "capability_unavailable"
              ? "当前 Provider 未配置这项能力。"
              : "任务不存在、尚未结束，或你的权限已经变化。";
    return { error };
  }
  revalidatePath("/settings/ai");
  return {
    success: result.created ? "已创建新的重试任务。" : "重试任务已经在队列中。",
  };
}
