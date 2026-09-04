"use server";

import { revalidatePath } from "next/cache";
import { requireFamilyCapability } from "@/lib/authz/context";
import {
  closeContributionRequest,
  createContributionRequest,
} from "@/lib/oral-history/service";

export type RequestActionState = {
  error?: string;
  token?: string;
  expiresAt?: string;
  message?: string;
};

export async function createRequestAction(
  _prev: RequestActionState | undefined,
  formData: FormData,
): Promise<RequestActionState> {
  void _prev;
  const context = await requireFamilyCapability("contribution:create");
  const recipientLabel = String(formData.get("recipientLabel") ?? "");
  const promptText = String(formData.get("promptText") ?? "");
  const topicKeyRaw = String(formData.get("topicKey") ?? "");
  const topicKey = topicKeyRaw && topicKeyRaw !== "custom" ? topicKeyRaw : null;
  const recipientPersonIdRaw = String(formData.get("recipientPersonId") ?? "");

  const result = createContributionRequest(context, {
    recipientLabel,
    promptText,
    topicKey,
    recipientPersonId: recipientPersonIdRaw || null,
  });
  if (!result.ok) {
    return {
      error:
        result.error === "invalid_label"
          ? "称呼需要 1–50 字。"
          : result.error === "invalid_prompt"
            ? "问题需要 1–500 字。"
            : result.error === "invalid_person"
              ? "所选家人已不存在，请刷新后重试。"
            : result.error === "too_many_open"
              ? "打开的链接太多（上限 20），先关闭一些。"
              : "创建失败。",
    };
  }
  revalidatePath("/requests");
  if (recipientPersonIdRaw) revalidatePath(`/family/${recipientPersonIdRaw}`);
  return {
    token: result.token,
    expiresAt: new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(
      result.expiresAt,
    ),
  };
}

export async function closeRequestAction(
  _prev: RequestActionState | undefined,
  formData: FormData,
): Promise<RequestActionState> {
  void _prev;
  const context = await requireFamilyCapability("contribution:create");
  const requestId = String(formData.get("requestId") ?? "");
  const result = closeContributionRequest(context, requestId);
  if (!result.ok) return { error: "关闭失败。" };
  revalidatePath("/requests");
  return { message: "链接已关闭。" };
}
