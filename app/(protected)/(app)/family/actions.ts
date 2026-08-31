"use server";

import { revalidatePath } from "next/cache";
import { requireFamilyCapability } from "@/lib/authz/context";
import { addPerson } from "@/lib/family/service";

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
