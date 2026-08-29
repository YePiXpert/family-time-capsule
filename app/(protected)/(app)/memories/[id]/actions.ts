"use server";

import { revalidatePath } from "next/cache";
import { requireFamily } from "@/lib/family/context";
import {
  addFact,
  createContribution,
  setFactStatus,
  updateContributionText,
  type Visibility,
} from "@/lib/contributions/service";

export type ContributionFormState = { error?: string };

const VISIBILITIES: Visibility[] = ["private", "parents", "family", "child_later"];

/** 新增家人视角：author 是 Person（可以不是登录用户，如外婆） */
export async function addContributionAction(
  _prev: ContributionFormState | undefined,
  formData: FormData,
): Promise<ContributionFormState> {
  const { familyId } = await requireFamily();
  const memoryEventId = String(formData.get("memoryEventId") ?? "");
  const authorPersonId = String(formData.get("authorPersonId") ?? "");
  const text = String(formData.get("text") ?? "");
  const visibilityInput = String(formData.get("visibility") ?? "family");
  const visibility = VISIBILITIES.includes(visibilityInput as Visibility)
    ? (visibilityInput as Visibility)
    : "family";

  const result = await createContribution(familyId, {
    memoryEventId,
    authorPersonId,
    rawText: text,
    visibility,
  });
  if (!result.ok) {
    return {
      error:
        result.error === "event_not_found"
          ? "事件不存在。"
          : result.error === "author_not_found"
            ? "请选择家庭成员。"
            : "写 1–5000 字。",
    };
  }
  revalidatePath(`/memories/${memoryEventId}`);
  return {};
}

/** 编辑自己的定稿（行级独立，不会覆盖其他人的文本） */
export async function editContributionAction(
  _prev: ContributionFormState | undefined,
  formData: FormData,
): Promise<ContributionFormState> {
  const { familyId } = await requireFamily();
  const contributionId = String(formData.get("contributionId") ?? "");
  const memoryEventId = String(formData.get("memoryEventId") ?? "");
  const text = String(formData.get("editedText") ?? "");
  const row = await updateContributionText(familyId, contributionId, text);
  if (!row) return { error: "保存失败：内容 1–5000 字，或条目不存在。" };
  revalidatePath(`/memories/${memoryEventId}`);
  return {};
}

export async function addFactAction(
  _prev: ContributionFormState | undefined,
  formData: FormData,
): Promise<ContributionFormState> {
  const { familyId } = await requireFamily();
  const memoryEventId = String(formData.get("memoryEventId") ?? "");
  const statement = String(formData.get("statement") ?? "");
  const row = await addFact(familyId, memoryEventId, statement);
  if (!row) return { error: "事实陈述需 1–500 字。" };
  revalidatePath(`/memories/${memoryEventId}`);
  return {};
}

export async function setFactStatusAction(
  _prev: ContributionFormState | undefined,
  formData: FormData,
): Promise<ContributionFormState> {
  const { familyId } = await requireFamily();
  const factId = String(formData.get("factId") ?? "");
  const memoryEventId = String(formData.get("memoryEventId") ?? "");
  const status = String(formData.get("status") ?? "") === "rejected" ? "rejected" : "user_confirmed";
  const row = await setFactStatus(familyId, factId, status);
  if (!row) return { error: "操作失败。" };
  revalidatePath(`/memories/${memoryEventId}`);
  return {};
}
