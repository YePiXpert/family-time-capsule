"use server";

import { revalidatePath } from "next/cache";
import { requireFamily } from "@/lib/family/context";
import { createTextInboxItem } from "@/lib/inbox/service";

export type TextFormState = { error?: string; saved?: boolean };

export async function createTextAction(
  _prev: TextFormState | undefined,
  formData: FormData,
): Promise<TextFormState> {
  const { familyId } = await requireFamily();
  const text = String(formData.get("text") ?? "").trim();
  if (text.length < 1 || text.length > 5000) {
    return { error: "写 1–5000 字。" };
  }
  await createTextInboxItem(familyId, text);
  revalidatePath("/inbox");
  return { saved: true };
}
