"use server";

import { revalidatePath } from "next/cache";
import { requireFamilyCapability } from "@/lib/authz/context";
import {
  requestTranscription,
  saveEditedTranscript,
} from "@/lib/transcripts/service";
import { requestImageAnalysis, requestVideoAnalysis } from "@/lib/analysis/service";
import {
  canCreateContributionForPerson,
  FamilyAuthorizationError,
} from "@/lib/authz/policy";
import {
  createContributionAccessSnapshot,
  updateVisibleContributionText,
} from "@/lib/authz/contribution-access";
import { getFamily } from "@/lib/family/service";
import { zonedWallTimeToUtc } from "@/lib/metadata/time";
import { updateMemoryEvent } from "@/lib/memories/service";
import {
  addFact,
  createContribution,
  setFactStatus,
  type Visibility,
} from "@/lib/contributions/service";
import {
  requestEventSuggestions,
  resolveSuggestion,
} from "@/lib/suggestions/service";

export type ContributionFormState = { error?: string };

export type EditEventFormState = { error?: string; saved?: boolean };

const PRECISIONS = ["exact", "approximate", "date_only"] as const;

/**
 * 编辑记忆事件（RH-003）。
 * datetime-local 是家庭时区墙钟时间；修改 occurredAt 只改事件时间，
 * 不触碰任何 Asset 的 capturedAt / importedAt。
 */
export async function editEventAction(
  _prev: EditEventFormState | undefined,
  formData: FormData,
): Promise<EditEventFormState> {
  const { familyId, userId } = await requireFamilyCapability("event:write");
  const eventId = String(formData.get("eventId") ?? "");
  const title = String(formData.get("title") ?? "").trim();

  const family = await getFamily(familyId);
  const timezone = family?.timezone ?? "Asia/Shanghai";

  let occurredAt: Date | undefined;
  const wall = String(formData.get("occurredAt") ?? "").trim();
  if (wall) {
    try {
      occurredAt = zonedWallTimeToUtc(
        wall.length === 16 ? `${wall}:00` : wall,
        timezone,
      );
    } catch {
      return { error: "时间格式不正确。" };
    }
  }

  const precisionInput = String(formData.get("occurredAtPrecision") ?? "");
  const occurredAtPrecision = PRECISIONS.includes(
    precisionInput as (typeof PRECISIONS)[number],
  )
    ? (precisionInput as (typeof PRECISIONS)[number])
    : undefined;

  const locationRaw = String(formData.get("locationText") ?? "").trim();

  const coverRaw = String(formData.get("coverAssetId") ?? "");
  const coverAssetId = coverRaw === "" ? undefined : coverRaw;

  const childRaw = String(formData.get("childPersonId") ?? "");
  const childPersonId = childRaw === "" ? undefined : childRaw;

  const participants = formData
    .getAll("participantPersonIds")
    .map((v) => String(v))
    .filter(Boolean);

  const result = await updateMemoryEvent(familyId, eventId, userId, {
    title,
    occurredAt,
    occurredAtPrecision,
    locationText: locationRaw || null,
    coverAssetId,
    childPersonId,
    participantPersonIds: participants,
  });
  if (!result.ok) {
    return {
      error:
        result.error === "not_found"
          ? "事件不存在。"
          : result.error === "bad_person"
            ? "参与人或孩子档案无效。"
            : result.error === "bad_cover"
              ? "封面素材无效。"
              : "请检查填写内容（标题 1–100 字）。",
    };
  }
  revalidatePath(`/memories/${eventId}`);
  revalidatePath("/timeline");
  return { saved: true };
}

const VISIBILITIES: Visibility[] = ["private", "parents", "family", "child_later"];

/** 新增家人视角：author 是 Person（可以不是登录用户，如外婆） */
export async function addContributionAction(
  _prev: ContributionFormState | undefined,
  formData: FormData,
): Promise<ContributionFormState> {
  const context = await requireFamilyCapability("contribution:create");
  const { familyId } = context;
  const memoryEventId = String(formData.get("memoryEventId") ?? "");
  const authorPersonId = String(formData.get("authorPersonId") ?? "");
  const text = String(formData.get("text") ?? "");
  const visibilityInput = String(formData.get("visibility") ?? "family");
  const visibility = VISIBILITIES.includes(visibilityInput as Visibility)
    ? (visibilityInput as Visibility)
    : "family";

  if (
    !canCreateContributionForPerson({
      role: context.role,
      userPersonId: context.personId,
      authorPersonId,
      accountEnabled: context.accountEnabled,
    })
  ) {
    throw new FamilyAuthorizationError("contribution:create");
  }

  const result = await createContribution(familyId, {
    memoryEventId,
    authorPersonId,
    recordedByUserId: context.userId,
    rawText: text,
    visibility,
  });
  if (!result.ok) {
    return {
      error:
        result.error === "event_not_found"
          ? "事件不存在。"
          : result.error === "author_not_found"
            ? "请选择家庭成员。"
            : result.error === "author_not_allowed"
              ? "该家人已有自己的登录账号，不能替对方发表观点。"
              : result.error === "forbidden"
                ? "你的账号权限已经变化，本次没有保存。"
                : "写 1–5000 字。",
    };
  }
  revalidatePath(`/memories/${memoryEventId}`);
  return {};
}

/** 编辑自己的定稿（行级独立，不会覆盖其他人的文本） */
export async function editContributionAction(
  _prev: ContributionFormState | undefined,
  formData: FormData,
): Promise<ContributionFormState> {
  const context = await requireFamilyCapability("contribution:create");
  const contributionId = String(formData.get("contributionId") ?? "");
  const text = String(formData.get("editedText") ?? "");
  const result = updateVisibleContributionText(
    createContributionAccessSnapshot(context),
    contributionId,
    text,
  );
  if (!result.ok) {
    return {
      error:
        result.error === "invalid"
          ? "保存失败：内容需为 1–5000 字。"
          : "保存失败：条目不存在，或你的账号权限已经变化。",
    };
  }
  revalidatePath(`/memories/${result.memoryEventId}`);
  return {};
}

export async function addFactAction(
  _prev: ContributionFormState | undefined,
  formData: FormData,
): Promise<ContributionFormState> {
  const { familyId } = await requireFamilyCapability("event:write");
  const memoryEventId = String(formData.get("memoryEventId") ?? "");
  const statement = String(formData.get("statement") ?? "");
  const row = await addFact(familyId, memoryEventId, statement);
  if (!row) return { error: "事实陈述需 1–500 字。" };
  revalidatePath(`/memories/${memoryEventId}`);
  return {};
}

export async function setFactStatusAction(
  _prev: ContributionFormState | undefined,
  formData: FormData,
): Promise<ContributionFormState> {
  const { familyId } = await requireFamilyCapability("event:write");
  const factId = String(formData.get("factId") ?? "");
  const memoryEventId = String(formData.get("memoryEventId") ?? "");
  const status = String(formData.get("status") ?? "") === "rejected" ? "rejected" : "user_confirmed";
  const row = await setFactStatus(familyId, factId, status);
  if (!row) return { error: "操作失败。" };
  revalidatePath(`/memories/${memoryEventId}`);
  return {};
}

export type TranscriptActionState = { error?: string; success?: string };

export type ImageAnalysisActionState = { error?: string; success?: string };

/** 为图片素材请求 AI 视觉分析（需要 ai:review）。 */
export async function requestImageAnalysisAction(
  _prev: ImageAnalysisActionState | undefined,
  formData: FormData,
): Promise<ImageAnalysisActionState> {
  const context = await requireFamilyCapability("ai:review");
  const assetId = String(formData.get("assetId") ?? "");
  const memoryEventId = String(formData.get("memoryEventId") ?? "");
  const result = requestImageAnalysis(context, assetId);
  if (!result.ok) {
    return {
      error:
        result.error === "asset_not_found"
          ? "素材不存在。"
          : result.error === "unsupported_asset_type"
            ? "该类型素材不支持图像分析。"
            : result.error === "unsupported_media_type"
              ? "该编码格式不支持分析，且没有可用的缩略图。"
              : result.error === "image_too_large"
                ? "图片超过 20 MiB 上限，无法分析。"
                : result.error === "source_forbidden_or_not_found"
                  ? "当前不可见或已被删除。"
                  : result.error === "capability_unavailable"
                    ? "当前未配置视觉分析能力。"
                    : result.error === "capability_not_consented"
                      ? "请先由管理员在「设置 › AI」开启视觉分析外部处理同意。"
                      : "请求失败，请重试。",
    };
  }
  revalidatePath(`/memories/${memoryEventId}`);
  return { success: "已加入图像分析队列。" };
}

/** 为视频素材请求 AI 视频理解（抽帧 + vision，需要 ai:review；M3-G）。 */
export async function requestVideoAnalysisAction(
  _prev: ImageAnalysisActionState | undefined,
  formData: FormData,
): Promise<ImageAnalysisActionState> {
  const context = await requireFamilyCapability("ai:review");
  const assetId = String(formData.get("assetId") ?? "");
  const memoryEventId = String(formData.get("memoryEventId") ?? "");
  const result = requestVideoAnalysis(context, assetId);
  if (!result.ok) {
    return {
      error:
        result.error === "asset_not_found"
          ? "素材不存在。"
          : result.error === "unsupported_asset_type"
            ? "只有视频素材支持视频理解。"
            : result.error === "source_forbidden_or_not_found"
              ? "当前不可见或已被删除。"
              : result.error === "capability_unavailable"
                ? "当前未配置视觉分析能力。"
                : result.error === "capability_not_consented"
                  ? "请先由管理员在「设置 › AI」开启视觉分析外部处理同意。"
                  : "请求失败，请重试。",
    };
  }
  revalidatePath(`/memories/${memoryEventId}`);
  return { success: "已加入视频理解队列。" };
}

/** 为音频/视频素材请求 AI 转录（需要 ai:review）。 */
export async function requestTranscriptionAction(
  _prev: TranscriptActionState | undefined,
  formData: FormData,
): Promise<TranscriptActionState> {
  const context = await requireFamilyCapability("ai:review");
  const assetId = String(formData.get("assetId") ?? "");
  const memoryEventId = String(formData.get("memoryEventId") ?? "");
  const result = requestTranscription(context, assetId);
  if (!result.ok) {
    return {
      error:
        result.error === "asset_not_found"
          ? "素材不存在。"
          : result.error === "unsupported_asset_type"
            ? "该类型素材不支持转录。"
            : result.error === "unsupported_media_type"
              ? "该编码格式不支持转录。"
              : result.error === "audio_too_large"
                ? "音频超过 25 MiB 上限，无法转录。"
                : result.error === "source_forbidden_or_not_found"
                  ? "当前不可见或已被删除。"
                  : result.error === "capability_unavailable"
                    ? "当前未配置转录能力。"
                    : result.error === "capability_not_consented"
                      ? "请先由管理员在「设置 › AI」开启转录外部处理同意。"
                      : "请求失败，请重试。",
    };
  }
  revalidatePath(`/memories/${memoryEventId}`);
  return { success: "已加入转录队列。" };
}

/** 保存用户对转录的修订（需要 event:write）。 */
export async function editTranscriptAction(
  _prev: TranscriptActionState | undefined,
  formData: FormData,
): Promise<TranscriptActionState> {
  const context = await requireFamilyCapability("event:write");
  const assetId = String(formData.get("assetId") ?? "");
  const memoryEventId = String(formData.get("memoryEventId") ?? "");
  const text = String(formData.get("editedText") ?? "");
  const result = saveEditedTranscript(context, assetId, text);
  if (!result.ok) {
    return {
      error:
        result.error === "invalid"
          ? "修订内容需为 1–200,000 字。"
          : result.error === "not_found"
            ? "素材不存在。"
            : "保存失败：权限已变化。",
    };
  }
  revalidatePath(`/memories/${memoryEventId}`);
  return { success: "修订已保存。" };
}

export type SuggestionActionState = { error?: string; success?: string };

export async function requestEventSuggestionsAction(
  _prev: SuggestionActionState | undefined,
  formData: FormData,
): Promise<SuggestionActionState> {
  const context = await requireFamilyCapability("ai:review");
  const memoryEventId = String(formData.get("memoryEventId") ?? "");
  const result = requestEventSuggestions(context, memoryEventId);
  if (!result.ok) {
    return {
      error:
        result.error === "forbidden"
          ? "你没有权限请求 AI 整理。"
          : result.error === "event_not_found"
            ? "事件不存在。"
            : result.error === "capability_unavailable"
              ? "当前未配置文本整理能力。"
              : result.error === "capability_not_consented"
                ? "请先由管理员在「设置 › AI」开启文本处理外部处理同意。"
                : "请求失败，请重试。",
    };
  }
  revalidatePath(`/memories/${memoryEventId}`);
  return { success: "已加入整理建议队列。" };
}

export async function resolveSuggestionAction(
  _prev: SuggestionActionState | undefined,
  formData: FormData,
): Promise<SuggestionActionState> {
  const context = await requireFamilyCapability("event:write");
  const suggestionId = String(formData.get("suggestionId") ?? "");
  const actionRaw = String(formData.get("action") ?? "");
  const action = actionRaw === "reject" ? "reject" : "accept";
  const editedValue = String(formData.get("editedValue") ?? "").trim() || undefined;
  const result = await resolveSuggestion(
    context.familyId,
    context.userId,
    suggestionId,
    action,
    editedValue,
  );
  if (!result.ok) {
    return {
      error:
        result.error === "not_found"
          ? "建议不存在。"
          : result.error === "already_resolved"
            ? "该建议已处理。"
            : result.error === "person_not_found"
              ? "所选家庭成员无效。"
              : result.error === "invalid_tag"
                ? "标签需为 1–50 字。"
                : result.error === "invalid_title"
                  ? "标题需为 1–100 字。"
                  : result.error === "invalid_location"
                    ? "地点需为 200 字以内。"
                    : "操作失败。",
    };
  }
  return { success: "已处理。" };
}
