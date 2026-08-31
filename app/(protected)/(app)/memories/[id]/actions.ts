"use server";

import { revalidatePath } from "next/cache";
import { requireFamilyCapability } from "@/lib/authz/context";
import {
  canCreateContributionForPerson,
  canEditContribution,
  FamilyAuthorizationError,
} from "@/lib/authz/policy";
import { getFamily } from "@/lib/family/service";
import { zonedWallTimeToUtc } from "@/lib/metadata/time";
import { updateMemoryEvent } from "@/lib/memories/service";
import {
  addFact,
  createContribution,
  getContributionForFamily,
  setFactStatus,
  updateContributionText,
  type Visibility,
} from "@/lib/contributions/service";

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
      accountEnabled: true,
    })
  ) {
    throw new FamilyAuthorizationError("contribution:create");
  }

  const result = await createContribution(familyId, {
    memoryEventId,
    authorPersonId,
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
  const { familyId } = context;
  const contributionId = String(formData.get("contributionId") ?? "");
  const text = String(formData.get("editedText") ?? "");
  const existing = await getContributionForFamily(familyId, contributionId);
  if (!existing) return { error: "保存失败：内容 1–5000 字，或条目不存在。" };
  if (
    !canEditContribution({
      role: context.role,
      userPersonId: context.personId,
      authorPersonId: existing.authorPersonId,
      isGuardian: false,
      childLaterUnlocked: false,
      accountEnabled: true,
    })
  ) {
    throw new FamilyAuthorizationError("contribution:create");
  }
  const row = await updateContributionText(familyId, contributionId, text);
  if (!row) return { error: "保存失败：内容 1–5000 字，或条目不存在。" };
  revalidatePath(`/memories/${existing.memoryEventId}`);
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
