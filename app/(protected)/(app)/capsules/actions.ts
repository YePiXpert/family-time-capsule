"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFamilyCapability } from "@/lib/authz/context";
import { getFamily, listPeople } from "@/lib/family/service";
import {
  addCapsuleAsset,
  addCapsuleContribution,
  addCapsuleEvent,
  createCapsule,
  openCapsule,
  sealCapsule,
  type UnlockType,
} from "@/lib/capsules/service";

export type CapsuleFormState = { error?: string };

async function capsuleContext() {
  const { familyId } = await requireFamilyCapability("capsule:write");
  const [family, people] = await Promise.all([getFamily(familyId), listPeople(familyId)]);
  const child = people.find((p) => p.isChild);
  return {
    familyId,
    familyTimezone: family?.timezone ?? "Asia/Shanghai",
    childBirthDate: child?.birthDate ?? null,
  };
}

export async function createCapsuleAction(
  _prev: CapsuleFormState | undefined,
  formData: FormData,
): Promise<CapsuleFormState> {
  const { familyId } = await requireFamilyCapability("capsule:write");
  const title = String(formData.get("title") ?? "").trim();
  const unlockType = (String(formData.get("unlockType") ?? "") === "age"
    ? "age"
    : "date") as UnlockType;
  const unlockValue = String(formData.get("unlockValue") ?? "").trim();
  const result = await createCapsule(familyId, { title, unlockType, unlockValue });
  if (!result.ok) {
    return { error: "请检查：标题 1–100 字；日期为 YYYY-MM-DD 或年龄为 1–100 的整数。" };
  }
  revalidatePath("/capsules");
  redirect(`/capsules/${result.capsuleId}`);
}

export async function addContentAction(
  _prev: CapsuleFormState | undefined,
  formData: FormData,
): Promise<CapsuleFormState> {
  const { familyId } = await requireFamilyCapability("capsule:write");
  const capsuleId = String(formData.get("capsuleId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const id = String(formData.get("id") ?? "");
  let ok = false;
  if (kind === "event") ok = await addCapsuleEvent(familyId, capsuleId, id);
  else if (kind === "asset") ok = await addCapsuleAsset(familyId, capsuleId, id);
  else if (kind === "contribution")
    ok = await addCapsuleContribution(familyId, capsuleId, id);
  if (!ok) return { error: "添加失败：内容不存在或胶囊已封存。" };
  revalidatePath(`/capsules/${capsuleId}`);
  return {};
}

export async function sealAction(
  _prev: CapsuleFormState | undefined,
  formData: FormData,
): Promise<CapsuleFormState> {
  const { familyId } = await requireFamilyCapability("capsule:write");
  const capsuleId = String(formData.get("capsuleId") ?? "");
  const row = await sealCapsule(familyId, capsuleId);
  if (!row) return { error: "封存失败：只有收集中的胶囊可以封存。" };
  revalidatePath(`/capsules/${capsuleId}`);
  revalidatePath("/capsules");
  return {};
}

export async function openAction(
  _prev: CapsuleFormState | undefined,
  formData: FormData,
): Promise<CapsuleFormState> {
  const { familyId, familyTimezone, childBirthDate } = await capsuleContext();
  const capsuleId = String(formData.get("capsuleId") ?? "");
  const result = await openCapsule(familyId, capsuleId, childBirthDate, familyTimezone);
  if (!result.ok) {
    return {
      error:
        result.error === "not_found"
          ? "胶囊不存在。"
          : "还没到开启的时间，再等等。",
    };
  }
  revalidatePath(`/capsules/${capsuleId}`);
  revalidatePath("/capsules");
  return {};
}
