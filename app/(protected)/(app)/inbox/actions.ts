"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFamily } from "@/lib/family/context";
import { getFamily } from "@/lib/family/service";
import { zonedWallTimeToUtc } from "@/lib/metadata/time";
import {
  discardInboxItem,
  getInboxEntry,
  setInboxItemAssetTime,
} from "@/lib/inbox/service";
import { confirmInboxEntry } from "@/lib/memories/service";

export type InboxActionState = { error?: string; itemId?: string };

/**
 * 修正时间：datetime-local 是家庭所在地的墙钟时间，按 Family.timezone 折算 UTC
 *（与 EXIF 无偏移的解释策略一致，DECISIONS D-009）。
 */
export async function editTimeAction(
  _prev: InboxActionState | undefined,
  formData: FormData,
): Promise<InboxActionState> {
  const { familyId } = await requireFamily();
  const itemId = String(formData.get("itemId") ?? "");
  const wall = String(formData.get("capturedAt") ?? ""); // YYYY-MM-DDTHH:mm
  const family = await getFamily(familyId);
  try {
    const capturedAt = zonedWallTimeToUtc(
      wall.length === 16 ? `${wall}:00` : wall,
      family?.timezone ?? "Asia/Shanghai",
    );
    const ok = await setInboxItemAssetTime(familyId, itemId, capturedAt);
    if (!ok) return { error: "条目不存在或没有可修改的素材。", itemId };
  } catch {
    return { error: "时间格式不正确。", itemId };
  }
  revalidatePath("/inbox");
  return {};
}

export async function discardAction(
  _prev: InboxActionState | undefined,
  formData: FormData,
): Promise<InboxActionState> {
  const { familyId } = await requireFamily();
  const itemId = String(formData.get("itemId") ?? "");
  const ok = await discardInboxItem(familyId, itemId);
  if (!ok) return { error: "条目不存在。", itemId };
  revalidatePath("/inbox");
  return {};
}

/**
 * 确认进入时间轴（#008）：创建 MemoryEvent。
 * occurredAt 默认取 Asset capturedAt（不是 importedAt）；可显式指定墙钟时间。
 */
export async function confirmAction(
  _prev: InboxActionState | undefined,
  formData: FormData,
): Promise<InboxActionState> {
  const { familyId } = await requireFamily();
  const itemId = String(formData.get("itemId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const occurredWall = String(formData.get("occurredAt") ?? "").trim();

  const entry = await getInboxEntry(familyId, itemId);
  if (!entry) return { error: "条目不存在。", itemId };

  let occurredAt: Date | undefined;
  if (occurredWall) {
    const family = await getFamily(familyId);
    try {
      occurredAt = zonedWallTimeToUtc(
        occurredWall.length === 16 ? `${occurredWall}:00` : occurredWall,
        family?.timezone ?? "Asia/Shanghai",
      );
    } catch {
      return { error: "时间格式不正确。", itemId };
    }
  }

  const result = await confirmInboxEntry(familyId, entry, {
    title: title || undefined,
    occurredAt,
  });
  if (!result.ok) {
    return {
      error:
        result.error === "no_child"
          ? "家庭还没有孩子档案，请先在「家人」页补充。"
          : "确认失败，请检查标题（1–100 字）。",
      itemId,
    };
  }
  revalidatePath("/inbox");
  revalidatePath("/timeline");
  redirect(`/memories/${result.eventId}`);
}
