"use server";

import { revalidatePath } from "next/cache";
import { requireFamilyCapability } from "@/lib/authz/context";
import {
  addCapsuleReply,
  addFutureQuestion,
  removeFutureQuestion,
} from "@/lib/capsules/dialogue";

export type DialogueActionState = { error?: string; message?: string };

export async function addQuestionAction(
  _prev: DialogueActionState | undefined,
  formData: FormData,
): Promise<DialogueActionState> {
  void _prev;
  const context = await requireFamilyCapability("capsule:write");
  const capsuleId = String(formData.get("capsuleId") ?? "");
  const questionText = String(formData.get("questionText") ?? "");
  const result = await addFutureQuestion(context, capsuleId, questionText);
  if (!result.ok) {
    return {
      error:
        result.error === "invalid_question"
          ? "问题需要 1–500 字。"
          : result.error === "sealed_immutable"
            ? "胶囊已封存，问题集不可再改。"
            : "添加失败。",
    };
  }
  revalidatePath(`/capsules/${capsuleId}`);
  return { message: "问题已添加。" };
}

export async function removeQuestionAction(
  _prev: DialogueActionState | undefined,
  formData: FormData,
): Promise<DialogueActionState> {
  void _prev;
  const context = await requireFamilyCapability("capsule:write");
  const capsuleId = String(formData.get("capsuleId") ?? "");
  const questionId = String(formData.get("questionId") ?? "");
  const result = await removeFutureQuestion(context, questionId);
  if (!result.ok) return { error: "删除失败（封存后不可改）。" };
  revalidatePath(`/capsules/${capsuleId}`);
  return { message: "问题已删除。" };
}

export async function addReplyAction(
  _prev: DialogueActionState | undefined,
  formData: FormData,
): Promise<DialogueActionState> {
  void _prev;
  const context = await requireFamilyCapability("capsule:write");
  const capsuleId = String(formData.get("capsuleId") ?? "");
  const questionId = String(formData.get("questionId") ?? "");
  const text = String(formData.get("text") ?? "");
  const file = formData.get("file");

  const media =
    file instanceof File && file.size > 0
      ? {
          filename: file.name || "回答媒体",
          declaredMime: file.type || "application/octet-stream",
          buffer: Buffer.from(await file.arrayBuffer()),
        }
      : null;

  const result = await addCapsuleReply(context, questionId, { text, media });
  if (!result.ok) {
    return {
      error:
        result.error === "capsule_locked"
          ? "胶囊还没到开启的时间。"
          : result.error === "empty_reply"
            ? "写点什么，或选择一个文件。"
            : result.error === "unsupported_media"
              ? "只支持图片、音频或视频。"
              : result.error === "too_large"
                ? "文件超过大小限制。"
                : "提交失败。",
    };
  }
  revalidatePath(`/capsules/${capsuleId}`);
  return { message: "回答已保存。" };
}
