"use server";

import { revalidatePath } from "next/cache";
import { requireFamilyCapability } from "@/lib/authz/context";
import {
  purgeFromTrash,
  restoreFromTrash,
  trashContribution,
  trashMemoryEvent,
  trashStory,
  type TrashKind,
} from "@/lib/trash/service";

export type TrashActionState = { error?: string; message?: string };

const KINDS: readonly TrashKind[] = ["memory_event", "contribution", "story"];

function parseKind(value: string): TrashKind | null {
  return KINDS.includes(value as TrashKind) ? (value as TrashKind) : null;
}

/** 事件详情页「移到回收站」 */
export async function trashEventAction(
  _prev: TrashActionState | undefined,
  formData: FormData,
): Promise<TrashActionState> {
  void _prev;
  const context = await requireFamilyCapability("event:write");
  const eventId = String(formData.get("eventId") ?? "");
  const result = trashMemoryEvent(context, eventId);
  if (!result.ok) return { error: "删除失败。" };
  revalidatePath(`/memories/${eventId}`);
  revalidatePath("/timeline");
  revalidatePath("/trash");
  return { message: "已移到回收站（可在回收站恢复）。" };
}

export async function trashStoryAction(
  _prev: TrashActionState | undefined,
  formData: FormData,
): Promise<TrashActionState> {
  void _prev;
  const context = await requireFamilyCapability("story:write");
  const storyId = String(formData.get("storyId") ?? "");
  const result = trashStory(context, storyId);
  if (!result.ok) return { error: "删除失败。" };
  revalidatePath(`/stories/${storyId}`);
  revalidatePath("/stories");
  revalidatePath("/trash");
  return { message: "已移到回收站。" };
}

export async function trashContributionAction(
  _prev: TrashActionState | undefined,
  formData: FormData,
): Promise<TrashActionState> {
  void _prev;
  const context = await requireFamilyCapability("contribution:create");
  const contributionId = String(formData.get("contributionId") ?? "");
  const result = trashContribution(context, contributionId);
  if (!result.ok) return { error: "删除失败。" };
  revalidatePath("/trash");
  return { message: "已移到回收站。" };
}

export async function restoreTrashAction(
  _prev: TrashActionState | undefined,
  formData: FormData,
): Promise<TrashActionState> {
  void _prev;
  const context = await requireFamilyCapability("event:write");
  const kind = parseKind(String(formData.get("kind") ?? ""));
  const id = String(formData.get("id") ?? "");
  if (!kind) return { error: "未知类型。" };
  const result = restoreFromTrash(context, kind, id);
  if (!result.ok) return { error: "恢复失败。" };
  revalidatePath("/trash");
  revalidatePath("/timeline");
  revalidatePath("/stories");
  return { message: "已恢复。" };
}

/** 显式清除：硬删除，不可恢复 */
export async function purgeTrashAction(
  _prev: TrashActionState | undefined,
  formData: FormData,
): Promise<TrashActionState> {
  void _prev;
  const context = await requireFamilyCapability("event:write");
  const kind = parseKind(String(formData.get("kind") ?? ""));
  const id = String(formData.get("id") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!kind) return { error: "未知类型。" };
  if (confirm !== "purge") return { error: "请勾选确认后再清除。" };
  const result = purgeFromTrash(context, kind, id);
  if (!result.ok) return { error: "清除失败。" };
  revalidatePath("/trash");
  return { message: "已彻底清除。" };
}
