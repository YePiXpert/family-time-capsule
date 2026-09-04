"use server";

import { revalidatePath } from "next/cache";
import { requireFamilyCapability } from "@/lib/authz/context";
import { createTextInboxItem, getInboxEntry, seedInboxDrafts } from "@/lib/inbox/service";
import { defaultTitle, confirmInboxEntry, mergeInboxEntries } from "@/lib/memories/service";
import { zonedWallTimeToUtc } from "@/lib/metadata/time";

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

export type CaptureFinalizeInput = {
  mode: "inbox" | "archive";
  itemIds: string[];
  text: string;
  title: string;
  occurredAtWall: string;
  locationText: string;
  participantPersonIds: string[];
};

export type CaptureFinalizeResult =
  | { ok: true; destination: "inbox"; itemCount: number }
  | { ok: true; destination: "memory"; eventId: string }
  | { ok: false; error: string };

/** Unified capture finish step: stage safely, or explicitly confirm as one event. */
export async function finalizeCaptureAction(
  input: CaptureFinalizeInput,
): Promise<CaptureFinalizeResult> {
  const context = await requireFamilyCapability(
    input.mode === "archive" ? "inbox:review" : "capture:create",
  );
  const text = input.text.trim();
  if (text.length > 5000) return { ok: false, error: "文字最多 5000 字。" };
  const itemIds = [...new Set(input.itemIds.filter(Boolean))];
  if (text) {
    const item = await createTextInboxItem(context.familyId, text);
    itemIds.push(item.id);
  }
  if (itemIds.length === 0) {
    return { ok: false, error: "请写一句话或选择至少一份素材。" };
  }
  let occurredAt: Date | undefined;
  if (input.occurredAtWall.trim()) {
    try {
      const wall = input.occurredAtWall.trim();
      occurredAt = zonedWallTimeToUtc(
        wall.length === 16 ? `${wall}:00` : wall,
        context.familyTimezone,
      );
    } catch {
      return { ok: false, error: "发生时间格式不正确；素材已经安全留在收件箱。" };
    }
  }

  if (input.mode === "inbox") {
    const saved = await seedInboxDrafts(context.familyId, itemIds, {
      title: input.title,
      occurredAt,
      locationText: input.locationText,
      participantPersonIds: input.participantPersonIds,
    });
    if (!saved) {
      return {
        ok: false,
        error: "内容已安全留在收件箱，但草稿信息未能保存，请刷新后重试。",
      };
    }
    revalidatePath("/");
    revalidatePath("/inbox");
    return { ok: true, destination: "inbox", itemCount: itemIds.length };
  }

  const firstEntry = await getInboxEntry(context.familyId, itemIds[0]!);
  if (!firstEntry) {
    return { ok: false, error: "素材已留在收件箱，但其中一项已被整理，请刷新后重试。" };
  }
  const title = input.title.trim() || defaultTitle(firstEntry);
  const common = {
    occurredAt,
    locationText: input.locationText,
    participantPersonIds: input.participantPersonIds,
  };
  const result =
    itemIds.length === 1
      ? await confirmInboxEntry(context.familyId, firstEntry, {
          ...common,
          title,
        })
      : await mergeInboxEntries(context.familyId, itemIds, {
          ...common,
          title,
        });
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "no_child"
          ? "请先补充孩子档案；素材仍安全留在收件箱。"
          : "无法直接入档，请到收件箱检查标题、时间和人物。",
    };
  }
  revalidatePath("/");
  revalidatePath("/inbox");
  revalidatePath("/timeline");
  return { ok: true, destination: "memory", eventId: result.eventId };
}
