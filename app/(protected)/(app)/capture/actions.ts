"use server";

import { revalidatePath } from "next/cache";
import { requireFamilyCapability } from "@/lib/authz/context";
import { createTextInboxItem } from "@/lib/inbox/service";

export type TextFormState = { error?: string; saved?: boolean };

export async function createTextAction(
  _prev: TextFormState | undefined,
  formData: FormData,
): Promise<TextFormState> {
  const { familyId } = await requireFamilyCapability("capture:create");
  const text = String(formData.get("text") ?? "").trim();
  if (text.length < 1 || text.length > 5000) {
    return { error: "写 1–5000 字。" };
  }
  await createTextInboxItem(familyId, text);
  revalidatePath("/inbox");
  return { saved: true };
}
