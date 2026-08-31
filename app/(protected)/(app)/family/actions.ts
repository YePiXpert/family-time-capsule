"use server";

import { revalidatePath } from "next/cache";
import { requireFamilyCapability } from "@/lib/authz/context";
import { addPerson } from "@/lib/family/service";
import {
  manuallyUnlockChildLater,
  setChildLaterUnlockAge,
  setPersonGuardian,
  type FamilyPolicyResult,
} from "@/lib/family/policy-service";

export type AddPersonFormState = { error?: string };

export async function addPersonAction(
  _prev: AddPersonFormState | undefined,
  formData: FormData,
): Promise<AddPersonFormState> {
  const { familyId } = await requireFamilyCapability("family:manage");
  const result = await addPerson(familyId, {
    displayName: String(formData.get("displayName") ?? ""),
    relationToChild: String(formData.get("relationToChild") ?? ""),
    birthDate: String(formData.get("birthDate") ?? ""),
  });
  if (!result.ok) {
    return { error: "请检查填写内容：姓名 1–50 字，出生日期为有效日期。" };
  }
  revalidatePath("/family");
  return {};
}

export type FamilyPolicyFormState = { error?: string; success?: string };

function policyError(result: Extract<FamilyPolicyResult, { ok: false }>): string {
  switch (result.error) {
    case "forbidden":
      return "你的管理员权限已经变化，本次操作未执行。";
    case "not_found":
      return "家人或家庭策略不存在。";
    case "invalid_age":
      return "解锁年龄必须是 1–100 的整数。";
    case "child_cannot_be_guardian":
      return "孩子档案不能设为监护人。";
    case "not_child":
      return "只有孩子档案可以手工解锁。";
    case "already_unlocked":
      return "这名孩子的“长大后可见”内容已经永久解锁。";
  }
}

export async function setGuardianAction(
  personId: string,
  nextValue: boolean,
  _previous: FamilyPolicyFormState | undefined,
  _formData: FormData,
): Promise<FamilyPolicyFormState> {
  void _previous;
  void _formData;
  const context = await requireFamilyCapability("family:manage");
  const result = setPersonGuardian(context, personId, nextValue);
  if (!result.ok) return { error: policyError(result) };
  revalidatePath("/family");
  return {
    success: nextValue ? "已授予监护人访问权。" : "已移除监护人访问权。",
  };
}

export async function setUnlockAgeAction(
  _previous: FamilyPolicyFormState | undefined,
  formData: FormData,
): Promise<FamilyPolicyFormState> {
  void _previous;
  const context = await requireFamilyCapability("family:manage");
  const unlockAge = Number(formData.get("unlockAge"));
  const result = setChildLaterUnlockAge(context, unlockAge);
  if (!result.ok) return { error: policyError(result) };
  revalidatePath("/family");
  return { success: `自动解锁年龄已设为 ${unlockAge} 岁。` };
}

export async function manuallyUnlockChildAction(
  childPersonId: string,
  _previous: FamilyPolicyFormState | undefined,
  formData: FormData,
): Promise<FamilyPolicyFormState> {
  void _previous;
  if (formData.get("confirmIrreversible") !== "yes") {
    return { error: "请先确认你了解此操作不可撤销。" };
  }
  const context = await requireFamilyCapability("family:manage");
  const result = manuallyUnlockChildLater(context, childPersonId);
  if (!result.ok) return { error: policyError(result) };
  revalidatePath("/family");
  return { success: "已永久解锁这名孩子的“长大后可见”内容。" };
}
