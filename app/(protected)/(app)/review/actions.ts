"use server";

import { revalidatePath } from "next/cache";
import { requireFamilyCapability } from "@/lib/authz/context";
import { updateMemoryEvent, isMilestoneType } from "@/lib/memories/service";
import { createContributionRequest } from "@/lib/oral-history/service";
import {
  generateReviewStory,
  requestReviewStoryOptimization,
  setReviewHighlight,
  setReviewProgress,
  updateReviewPreferences,
} from "@/lib/review/service";

function reviewPath(formData: FormData): string {
  const key = String(formData.get("periodKey") ?? "");
  return /^\d{4}-\d{2}-\d{2}$/u.test(key) ? `/review/${key}` : "/review";
}

function refresh(formData: FormData): void {
  revalidatePath(reviewPath(formData));
  revalidatePath("/");
}

export async function changeReviewProgressAction(formData: FormData): Promise<void> {
  const context = await requireFamilyCapability("story:write");
  const operation = String(formData.get("operation"));
  if (!(operation === "start" || operation === "complete" || operation === "reopen")) return;
  await setReviewProgress(context, String(formData.get("reviewId") ?? ""), operation);
  refresh(formData);
}

export async function toggleReviewHighlightAction(formData: FormData): Promise<void> {
  const context = await requireFamilyCapability("story:write");
  await setReviewHighlight(
    context,
    String(formData.get("reviewId") ?? ""),
    String(formData.get("eventId") ?? ""),
    String(formData.get("selected")) === "1",
  );
  refresh(formData);
}

export async function editReviewMemoryAction(formData: FormData): Promise<{ error?: string; saved?: boolean; revision?: number }> {
  const context = await requireFamilyCapability("event:write");
  const milestoneRaw = String(formData.get("milestoneType") ?? "");
  const milestoneType = milestoneRaw === "" ? null : isMilestoneType(milestoneRaw) ? milestoneRaw : undefined;
  if (milestoneType === undefined) return { error: "成长节点无效。" };
  const participantPersonIds = formData.getAll("participantPersonId").map(String);
  const expectedRevision = Number(formData.get("expectedRevision"));
  const mutationId = String(formData.get("mutationId") ?? "");
  if (!formData.has("expectedRevision") || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !/^[\w-]{1,128}$/u.test(mutationId)) return { error: "页面版本无效，请保留输入并重新打开。" };
  const result = await updateMemoryEvent(context.familyId, String(formData.get("eventId") ?? ""), context.userId, {
    expectedTitleRevision: expectedRevision, mutationId,
    title: String(formData.get("title") ?? ""),
    locationText: String(formData.get("locationText") ?? ""),
    participantPersonIds,
    milestoneType,
  });
  if (!result.ok) return { error: result.error === "conflict" ? "这件事已被修改。你的输入已保留，请重新打开并核对。" : "无法保存，请核对内容和编辑权限。输入已保留。" };
  refresh(formData);
  return { saved: true, revision: result.event.titleRevision };
}

export async function generateReviewStoryAction(formData: FormData): Promise<void> {
  const context = await requireFamilyCapability("story:write");
  await generateReviewStory(context, String(formData.get("reviewId") ?? ""));
  refresh(formData);
  revalidatePath("/stories");
}

export async function optimizeReviewStoryAction(formData: FormData): Promise<void> {
  const context = await requireFamilyCapability("ai:review");
  await requestReviewStoryOptimization(context, String(formData.get("reviewId") ?? ""));
  refresh(formData);
  revalidatePath("/stories");
}

export async function updateReviewPreferencesAction(formData: FormData): Promise<void> {
  const context = await requireFamilyCapability("family:manage");
  await updateReviewPreferences(context, {
    weekStartsOn: Number(formData.get("weekStartsOn")),
    reminderWeekday: Number(formData.get("reminderWeekday")),
    reminderLocalTime: String(formData.get("reminderLocalTime") ?? ""),
    remindPendingInbox: formData.get("remindPendingInbox") === "on",
    remindPendingRequests: formData.get("remindPendingRequests") === "on",
    remindUpcomingCapsules: formData.get("remindUpcomingCapsules") === "on",
  });
  refresh(formData);
}

export type ReviewQuestionState = { token?: string; error?: string };

export async function createReviewQuestionAction(
  _previous: ReviewQuestionState | undefined,
  formData: FormData,
): Promise<ReviewQuestionState> {
  const context = await requireFamilyCapability("contribution:create");
  const result = createContributionRequest(context, {
    recipientLabel: String(formData.get("recipientLabel") ?? ""),
    recipientPersonId: String(formData.get("recipientPersonId") ?? "") || null,
    promptText: String(formData.get("promptText") ?? ""),
  });
  if (!result.ok) return { error: "问题创建失败，请检查称呼和问题。" };
  revalidatePath(reviewPath(formData));
  revalidatePath("/requests");
  return { token: result.token };
}
