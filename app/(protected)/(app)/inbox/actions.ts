"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { aiSuggestion } from "@/db/schema/suggestion";
import { requireFamilyCapability } from "@/lib/authz/context";
import { getFamily } from "@/lib/family/service";
import { zonedWallTimeToUtc } from "@/lib/metadata/time";
import {
  discardInboxItem,
  getInboxEntry,
  setInboxItemAssetTime,
} from "@/lib/inbox/service";
import { confirmInboxEntry, mergeInboxEntries } from "@/lib/memories/service";
import {
  requestInboxSuggestionsBatch,
  resolveInboxSuggestion,
} from "@/lib/suggestions/service";
import {
  resolveClusterSuggestion,
  scanInboxClusters,
} from "@/lib/clusters/service";

export type InboxActionState = { error?: string; itemId?: string };

/**
 * 条目确认/丢弃后，其 pending 建议随之落定：
 * 确认 = 已被用户采用（accepted，audit 记录），丢弃 = 不再相关（rejected）。
 */
async function settlePendingSuggestions(
  familyId: string,
  userId: string,
  inboxItemId: string,
  status: "accepted" | "rejected",
): Promise<void> {
  const db = getDb();
  const now = new Date();
  db.update(aiSuggestion)
    .set({ status, resolvedAt: now, resolvedByUserId: userId })
    .where(
      and(
        eq(aiSuggestion.familyId, familyId),
        eq(aiSuggestion.entityType, "inbox_item"),
        eq(aiSuggestion.entityId, inboxItemId),
        eq(aiSuggestion.status, "pending"),
      ),
    )
    .run();
}

/**
 * 修正时间：datetime-local 是家庭所在地的墙钟时间，按 Family.timezone 折算 UTC
 *（与 EXIF 无偏移的解释策略一致，DECISIONS D-009）。
 */
export async function editTimeAction(
  _prev: InboxActionState | undefined,
  formData: FormData,
): Promise<InboxActionState> {
  const { familyId } = await requireFamilyCapability("inbox:review");
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
  const { familyId, userId } = await requireFamilyCapability("inbox:review");
  const itemId = String(formData.get("itemId") ?? "");
  const ok = await discardInboxItem(familyId, itemId);
  if (!ok) return { error: "条目不存在。", itemId };
  await settlePendingSuggestions(familyId, userId, itemId, "rejected");
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
  const { familyId, userId } = await requireFamilyCapability("inbox:review");
  const itemId = String(formData.get("itemId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const occurredWall = String(formData.get("occurredAt") ?? "").trim();
  const locationText = String(formData.get("locationText") ?? "").trim();
  const participantPersonIds = formData
    .getAll("participantPersonIds")
    .map(String)
    .filter(Boolean);

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
    locationText,
    participantPersonIds,
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
  // 用户已亲自确认 → 本条目的 pending AI 建议视为已采用（含预填的 occurredAt）
  await settlePendingSuggestions(familyId, userId, itemId, "accepted");
  revalidatePath("/inbox");
  revalidatePath("/timeline");
  redirect(`/memories/${result.eventId}`);
}

/**
 * 多选合并（#010）：N 个收件箱条目 → 一个 MemoryEvent。
 * occurredAt 默认取全部素材最早可信 capturedAt，可显式覆盖。
 */
export async function mergeAction(
  _prev: InboxActionState | undefined,
  formData: FormData,
): Promise<InboxActionState> {
  const { familyId, userId } = await requireFamilyCapability("inbox:review");
  const itemIds = formData
    .getAll("itemIds")
    .map((v) => String(v))
    .filter(Boolean);
  const title = String(formData.get("title") ?? "").trim();
  const occurredWall = String(formData.get("occurredAt") ?? "").trim();
  const locationText = String(formData.get("locationText") ?? "").trim();
  const participantPersonIds = formData
    .getAll("participantPersonIds")
    .map(String)
    .filter(Boolean);

  let occurredAt: Date | undefined;
  if (occurredWall) {
    const family = await getFamily(familyId);
    try {
      occurredAt = zonedWallTimeToUtc(
        occurredWall.length === 16 ? `${occurredWall}:00` : occurredWall,
        family?.timezone ?? "Asia/Shanghai",
      );
    } catch {
      return { error: "时间格式不正确。" };
    }
  }

  const result = await mergeInboxEntries(familyId, itemIds, {
    title,
    occurredAt,
    locationText,
    participantPersonIds,
  });
  if (!result.ok) {
    return {
      error:
        result.error === "no_child"
          ? "家庭还没有孩子档案。"
          : "合并失败：至少选择两个条目，标题 1–100 字。",
    };
  }
  await Promise.all(
    itemIds.map((itemId) =>
      settlePendingSuggestions(familyId, userId, itemId, "accepted"),
    ),
  );
  revalidatePath("/inbox");
  revalidatePath("/timeline");
  redirect(`/memories/${result.eventId}`);
}

export type SuggestionActionState = { error?: string; message?: string };

/** M3-E：为收件箱开放条目批量请求 AI 整理建议（worker 异步处理） */
export async function requestInboxSuggestionsAction(
  _prev: SuggestionActionState | undefined,
  _formData: FormData,
): Promise<SuggestionActionState> {
  void _prev;
  void _formData;
  const context = await requireFamilyCapability("ai:review");
  const result = requestInboxSuggestionsBatch(context);
  revalidatePath("/inbox");
  return {
    message: `已请求 ${result.requested} 条整理建议${result.skipped > 0 ? `（跳过 ${result.skipped} 条已有建议或处理中）` : ""}。`,
  };
}

/** M3-E：单条收件箱建议 accept（预填/采用记录）/ reject（永不采用） */
export async function resolveInboxSuggestionAction(
  _prev: SuggestionActionState | undefined,
  formData: FormData,
): Promise<SuggestionActionState> {
  const { familyId, userId } = await requireFamilyCapability("ai:review");
  const suggestionId = String(formData.get("suggestionId") ?? "");
  const action = String(formData.get("action") ?? "");
  if (action !== "accept" && action !== "reject") {
    return { error: "未知操作。" };
  }
  const result = await resolveInboxSuggestion(
    familyId,
    userId,
    suggestionId,
    action,
  );
  if (!result.ok) return { error: "建议不存在或已处理。" };
  revalidatePath("/inbox");
  return {};
}

export type ClusterActionState = { error?: string; eventId?: string };

/** M3-F：本地（无 AI）聚类扫描——时间邻近 / 感知相似 / Live Photo 配对 */
export async function scanClustersAction(
  _prev: SuggestionActionState | undefined,
  _formData: FormData,
): Promise<SuggestionActionState> {
  void _prev;
  void _formData;
  const context = await requireFamilyCapability("inbox:review");
  const result = await scanInboxClusters(context);
  revalidatePath("/inbox");
  return {
    message:
      result.created > 0
        ? `发现 ${result.created} 组可能属于同一事件的条目${result.refreshed > 0 ? `（清理 ${result.refreshed} 条过期建议）` : ""}。`
        : "没有发现新的分簇建议。",
  };
}

/** M3-F：接受分簇 → 走既有合并流程创建/合并 MemoryEvent；忽略 → 永不自动执行 */
export async function resolveClusterAction(
  _prev: ClusterActionState | undefined,
  formData: FormData,
): Promise<ClusterActionState> {
  const context = await requireFamilyCapability("inbox:review");
  const suggestionId = String(formData.get("suggestionId") ?? "");
  const action = String(formData.get("action") ?? "");
  const titleOverride = String(formData.get("title") ?? "").trim();
  if (action !== "accept" && action !== "dismiss") {
    return { error: "未知操作。" };
  }
  const result = await resolveClusterSuggestion(
    context,
    suggestionId,
    action,
    titleOverride || undefined,
  );
  revalidatePath("/inbox");
  if (!result.ok) {
    return { error: "分簇建议不存在、已处理或成员已变化。" };
  }
  if (result.eventId) {
    revalidatePath("/timeline");
    redirect(`/memories/${result.eventId}`);
  }
  return {};
}
