"use server";

import { revalidatePath } from "next/cache";
import { requireFamilyCapability } from "@/lib/authz/context";
import {
  addManualParagraph,
  createStoryDraft,
  deleteParagraph,
  periodForKind,
  planDeterministicDraft,
  publishStory,
  collectStoryMaterial,
  collectTranscriptMaterial,
  regenerateOrCreateStory,
  requestStoryGeneration,
  updateParagraphText,
  updateStoryTitle,
  STORY_KINDS,
  type StoryKind,
} from "@/lib/stories/service";

export type StoryActionState = { error?: string; message?: string };

function parseKind(value: string): StoryKind | null {
  return STORY_KINDS.includes(value as StoryKind) ? (value as StoryKind) : null;
}

/** 无 AI 的确定性草稿：从确认事实 + family 讲述 + 修订转录组装 */
export async function createDeterministicDraftAction(
  _prev: StoryActionState | undefined,
  formData: FormData,
): Promise<StoryActionState> {
  void _prev;
  const context = await requireFamilyCapability("story:write");
  const kind = parseKind(String(formData.get("kind") ?? ""));
  const anchorRaw = String(formData.get("anchor") ?? "");
  if (!kind || !anchorRaw) return { error: "请选择类型和日期。" };
  const anchor = new Date(anchorRaw);
  if (Number.isNaN(anchor.getTime())) return { error: "日期不合法。" };

  const period = periodForKind(kind, anchor);
  const material = collectStoryMaterial(context.familyId, period);
  const transcripts = collectTranscriptMaterial(context.familyId, period);
  const plans = planDeterministicDraft(material, transcripts);
  const result = createStoryDraft(context, { kind, anchor }, plans);
  if (!result.ok) {
    return {
      error:
        result.error === "no_story_material"
          ? "这个时间段还没有可用的已确认内容（事实/讲述/转录）。"
          : "创建失败。",
    };
  }
  revalidatePath("/stories");
  return { message: "草稿已创建。" };
}

/** AI 生成（worker 异步）；无 text 能力时由前端回退确定性草稿 */
export async function requestGenerationAction(
  _prev: StoryActionState | undefined,
  formData: FormData,
): Promise<StoryActionState> {
  void _prev;
  const context = await requireFamilyCapability("ai:review");
  const kind = parseKind(String(formData.get("kind") ?? ""));
  const anchorRaw = String(formData.get("anchor") ?? "");
  if (!kind || !anchorRaw) return { error: "请选择类型和日期。" };
  const anchor = new Date(anchorRaw);
  if (Number.isNaN(anchor.getTime())) return { error: "日期不合法。" };

  const result = requestStoryGeneration(context, { kind, anchor });
  if (!result.ok) {
    return {
      error:
        result.error === "no_story_material"
          ? "这个时间段没有事件。"
          : result.error === "capability_unavailable"
            ? "当前未配置文本能力，可先用「离线组装草稿」。"
            : "请求失败，请重试。",
    };
  }
  revalidatePath("/stories");
  return { message: "已加入生成队列，稍后刷新查看。" };
}

export async function regenerateDraftAction(
  _prev: StoryActionState | undefined,
  formData: FormData,
): Promise<StoryActionState> {
  void _prev;
  const context = await requireFamilyCapability("story:write");
  const kind = parseKind(String(formData.get("kind") ?? ""));
  const anchorRaw = String(formData.get("anchor") ?? "");
  if (!kind || !anchorRaw) return { error: "参数不完整。" };
  const anchor = new Date(anchorRaw);

  const period = periodForKind(kind, anchor);
  const material = collectStoryMaterial(context.familyId, period);
  const transcripts = collectTranscriptMaterial(context.familyId, period);
  const plans = planDeterministicDraft(material, transcripts);
  const result = regenerateOrCreateStory(context, { kind, anchor }, plans);
  if (!result.ok) return { error: "没有可再生的素材。" };
  revalidatePath("/stories");
  revalidatePath(`/stories/${result.storyId}`);
  return { message: result.replacedDraft ? "草稿已重新生成。" : "已生成新草稿（旧版本已保留）。" };
}

export async function updateTitleAction(
  _prev: StoryActionState | undefined,
  formData: FormData,
): Promise<StoryActionState> {
  void _prev;
  const context = await requireFamilyCapability("story:write");
  const storyId = String(formData.get("storyId") ?? "");
  const title = String(formData.get("title") ?? "");
  const result = updateStoryTitle(context, storyId, title);
  if (!result.ok) {
    return {
      error:
        result.error === "published_immutable"
          ? "已发布的故事不可修改。"
          : result.error === "invalid_title"
            ? "标题需为 1–100 字。"
            : "修改失败。",
    };
  }
  revalidatePath(`/stories/${storyId}`);
  return { message: "标题已更新。" };
}

export async function updateParagraphAction(
  _prev: StoryActionState | undefined,
  formData: FormData,
): Promise<StoryActionState> {
  void _prev;
  const context = await requireFamilyCapability("story:write");
  const storyId = String(formData.get("storyId") ?? "");
  const paragraphId = String(formData.get("paragraphId") ?? "");
  const text = String(formData.get("text") ?? "");
  const result = updateParagraphText(context, paragraphId, text);
  if (!result.ok) {
    return {
      error:
        result.error === "quote_paragraph_immutable"
          ? "引文段落不可编辑（保证逐字来自原始讲述）；如需修改请删除后手动添加。"
          : result.error === "quote_characters_not_allowed"
            ? "叙述段落中不允许出现引号字符「」“”。"
            : result.error === "published_immutable"
              ? "已发布的故事不可修改。"
              : "修改失败。",
    };
  }
  revalidatePath(`/stories/${storyId}`);
  return { message: "段落已更新。" };
}

export async function deleteParagraphAction(
  _prev: StoryActionState | undefined,
  formData: FormData,
): Promise<StoryActionState> {
  void _prev;
  const context = await requireFamilyCapability("story:write");
  const storyId = String(formData.get("storyId") ?? "");
  const paragraphId = String(formData.get("paragraphId") ?? "");
  const result = deleteParagraph(context, paragraphId);
  if (!result.ok) {
    return {
      error: result.error === "published_immutable" ? "已发布的故事不可修改。" : "删除失败。",
    };
  }
  revalidatePath(`/stories/${storyId}`);
  return { message: "段落已删除。" };
}

export async function addParagraphAction(
  _prev: StoryActionState | undefined,
  formData: FormData,
): Promise<StoryActionState> {
  void _prev;
  const context = await requireFamilyCapability("story:write");
  const storyId = String(formData.get("storyId") ?? "");
  const text = String(formData.get("text") ?? "");
  const result = addManualParagraph(context, storyId, text);
  if (!result.ok) {
    return {
      error:
        result.error === "quote_characters_not_allowed"
          ? "手写段落不允许出现引号字符「」“”；直接引用请从讲述原文生成。"
          : result.error === "published_immutable"
            ? "已发布的故事不可修改。"
            : "添加失败。",
    };
  }
  revalidatePath(`/stories/${storyId}`);
  return { message: "段落已添加。" };
}

export async function publishStoryAction(
  _prev: StoryActionState | undefined,
  formData: FormData,
): Promise<StoryActionState> {
  void _prev;
  const context = await requireFamilyCapability("story:write");
  const storyId = String(formData.get("storyId") ?? "");
  const result = publishStory(context, storyId);
  if (!result.ok) {
    return {
      error: result.error === "empty_story" ? "空故事不能发布。" : "发布失败。",
    };
  }
  revalidatePath(`/stories/${storyId}`);
  revalidatePath("/stories");
  return { message: "故事已发布。" };
}
