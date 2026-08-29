"use server";

import { revalidatePath } from "next/cache";
import { requireFamily } from "@/lib/family/context";
import { getFamily } from "@/lib/family/service";
import { zonedWallTimeToUtc } from "@/lib/metadata/time";
import {
  discardInboxItem,
  setInboxItemAssetTime,
} from "@/lib/inbox/service";

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
