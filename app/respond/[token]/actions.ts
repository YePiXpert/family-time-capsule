"use server";

import { revalidatePath } from "next/cache";
import { submitGuestText } from "@/lib/oral-history/service";

export type GuestSubmitState = { error?: string; success?: boolean };

/** 访客提交文字（无会话：凭 token 授权，进入收件箱审核队列） */
export async function submitGuestTextAction(
  _prev: GuestSubmitState | undefined,
  formData: FormData,
): Promise<GuestSubmitState> {
  void _prev;
  const token = String(formData.get("token") ?? "");
  const text = String(formData.get("text") ?? "");
  const result = await submitGuestText(token, text);
  if (!result.ok) {
    return {
      error:
        result.error === "invalid_text"
          ? "内容需要 1–10000 字。"
          : result.error === "rate_limited"
            ? "这个链接这一小时内的提交已满，请稍后再试。"
            : result.error === "expired"
              ? "链接已过期。"
              : result.error === "closed"
                ? "链接已关闭。"
                : "链接无效。",
    };
  }
  revalidatePath("/inbox");
  return { success: true };
}
