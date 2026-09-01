"use server";

import { revalidatePath } from "next/cache";
import { submitGuestText, submitGuestMedia } from "@/lib/oral-history/service";

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

/** 访客提交录音 / 照片 / 视频（校验沿用上传白名单与大小限制） */
export async function submitGuestMediaAction(
  _prev: GuestSubmitState | undefined,
  formData: FormData,
): Promise<GuestSubmitState> {
  void _prev;
  const token = String(formData.get("token") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "请选择要上传的文件。" };
  }
  if (file.size > 500 * 1024 * 1024) {
    return { error: "文件过大（视频上限 500MB，音频 200MB，图片 50MB）。" };
  }
  const lastModifiedRaw = formData.get("lastModified");
  const clientLastModifiedMs =
    typeof lastModifiedRaw === "string" && /^\d+$/.test(lastModifiedRaw)
      ? Number(lastModifiedRaw)
      : null;

  const result = await submitGuestMedia(token, {
    filename: file.name || "提交的媒体",
    declaredMime: file.type || "application/octet-stream",
    buffer: Buffer.from(await file.arrayBuffer()),
    clientLastModifiedMs,
  });
  if (!result.ok) {
    return {
      error:
        result.error === "rate_limited"
          ? "这个链接这一小时内的提交已满，请稍后再试。"
          : result.error === "unsupported_media"
            ? "只支持图片、音频或视频文件。"
            : result.error === "too_large"
              ? "文件超过大小限制。"
              : result.error === "expired"
                ? "链接已过期。"
                : result.error === "closed"
                  ? "链接已关闭。"
                  : "上传失败，请检查文件格式。",
    };
  }
  revalidatePath("/inbox");
  return { success: true };
}
