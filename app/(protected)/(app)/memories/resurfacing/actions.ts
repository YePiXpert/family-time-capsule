"use server";

import { revalidatePath } from "next/cache";
import { requireFamily } from "@/lib/family/context";
import {
  addResurfacingBlock,
  removeResurfacingBlock,
} from "@/lib/memories/resurfacing-preferences";

/**
 * §8 FIND-9：回顾屏蔽是当前用户自己的偏好——只影响自动推荐，
 * 不删除来源、不影响其他家人与主动搜索/打开。
 */
export async function blockEventAction(formData: FormData): Promise<void> {
  const context = await requireFamily();
  addResurfacingBlock(context, { kind: "event", eventId: String(formData.get("eventId") ?? "") });
  revalidatePath("/memories/resurfacing");
  revalidatePath("/");
}

export async function blockPersonAction(formData: FormData): Promise<void> {
  const context = await requireFamily();
  addResurfacingBlock(context, { kind: "person", personId: String(formData.get("personId") ?? "") });
  revalidatePath("/memories/resurfacing");
  revalidatePath("/");
}

export async function blockDateRangeAction(formData: FormData): Promise<void> {
  const context = await requireFamily();
  addResurfacingBlock(context, {
    kind: "date_range",
    dateFrom: String(formData.get("dateFrom") ?? ""),
    dateTo: String(formData.get("dateTo") ?? "") || String(formData.get("dateFrom") ?? ""),
  });
  revalidatePath("/memories/resurfacing");
  revalidatePath("/");
}

export async function pauseResurfacingAction(): Promise<void> {
  const context = await requireFamily();
  addResurfacingBlock(context, { kind: "pause" });
  revalidatePath("/memories/resurfacing");
  revalidatePath("/");
}

export async function unblockAction(formData: FormData): Promise<void> {
  const context = await requireFamily();
  removeResurfacingBlock(context, String(formData.get("preferenceId") ?? ""));
  revalidatePath("/memories/resurfacing");
  revalidatePath("/");
}
