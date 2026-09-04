import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { reviewPeriod } from "@/db/schema/review";
import { story, storyParagraph, storySource } from "@/db/schema/story";
import { AiJobHandlerError, type AiJobHandler } from "@/jobs/types";
import {
  collectStoryMaterial,
  collectTranscriptMaterial,
  getStory,
  MAX_PARAGRAPH_CHARS,
  verifyQuoteLock,
  type DraftParagraphPlan,
} from "@/lib/stories/service";

const MAX_NARRATIVES = 60;

/** AI may refine wording and order only; immutable quotes and source edges are copied verbatim. */
export const optimizeReviewStoryHandler: AiJobHandler = async ({ lease, assistant, signal }) => {
  const period = getDb().select().from(reviewPeriod).where(and(
    eq(reviewPeriod.id, lease.entityId), eq(reviewPeriod.familyId, lease.familyId),
  )).get();
  if (!period?.storyId) throw new AiJobHandlerError("review_story_not_found", false);
  const detail = await getStory(lease.familyId, period.storyId);
  if (!detail || detail.story.status !== "draft" || detail.story.editedAt !== null) {
    throw new AiJobHandlerError("review_story_edited", false);
  }
  const narratives = detail.paragraphs.filter((paragraph) => paragraph.kind === "narrative").slice(0, MAX_NARRATIVES);
  if (!narratives.length) throw new AiJobHandlerError("no_story_material", false);
  const aliases = new Map(narratives.map((paragraph, index) => [`N${index + 1}`, paragraph]));
  const prompt = [
    "请只优化下列家庭周记叙述段的表达和排列，不添加事实，不写引文，不改变任何日期、人物、地点或事件含义。",
    "每段已有来源边界；输出段必须引用且只能引用一个原段别名。家人原话引文由系统另行逐字保留，不在这里处理。",
    ...[...aliases].map(([alias, paragraph]) => `[${alias}] ${paragraph.text}`),
    "严格输出 JSON：{\"paragraphs\":[{\"ref\":\"N1\",\"text\":\"优化后的叙述\"}]}。不得输出 JSON 外文字。",
  ].join("\n");
  let optimized = new Map<string, string>();
  try {
    const response = await assistant.generateText({
      messages: [{ role: "user", content: prompt }], responseFormat: "json", signal,
    });
    const parsed = JSON.parse(response.text) as { paragraphs?: unknown };
    if (Array.isArray(parsed.paragraphs)) {
      for (const raw of parsed.paragraphs) {
        if (!raw || typeof raw !== "object") continue;
        const { ref, text } = raw as Record<string, unknown>;
        if (typeof ref !== "string" || !aliases.has(ref) || optimized.has(ref) || typeof text !== "string") continue;
        const normalized = text.trim();
        if (!normalized || normalized.length > MAX_PARAGRAPH_CHARS || /[「」“”]/u.test(normalized)) continue;
        optimized.set(ref, normalized);
      }
    }
  } catch {
    optimized = new Map();
  }
  const sourcesOf = (paragraph: typeof detail.paragraphs[number]): DraftParagraphPlan["sources"] => paragraph.sources.flatMap((source) => (
    source.sourceId && ["fact", "contribution", "transcript", "memory_event"].includes(source.sourceType)
      ? [{
        sourceType: source.sourceType as DraftParagraphPlan["sources"][number]["sourceType"],
        sourceId: source.sourceId,
        quote: source.quote,
      }]
      : []
  ));
  const optimizedPlans: DraftParagraphPlan[] = [...aliases].map(([alias, paragraph]) => ({
    kind: "narrative",
    text: optimized.get(alias) ?? paragraph.text,
    sources: sourcesOf(paragraph),
  }));
  const quotePlans: DraftParagraphPlan[] = detail.paragraphs.filter((paragraph) => paragraph.kind === "quote").map((paragraph) => ({
    kind: "quote", text: paragraph.text,
    sources: sourcesOf(paragraph),
  }));
  const plans = [...optimizedPlans, ...quotePlans];
  const storyPeriod = { start: period.periodStart, end: period.periodEnd };
  const material = collectStoryMaterial(lease.familyId, storyPeriod);
  const transcripts = collectTranscriptMaterial(lease.familyId, storyPeriod);
  if (plans.some((plan) => plan.sources.length === 0 || !verifyQuoteLock(plan, material, transcripts))) {
    throw new AiJobHandlerError("review_quote_lock_failed", false);
  }

  return { commit: (tx, finalize) => {
    const live = tx.select({ id: story.id }).from(story).innerJoin(reviewPeriod, eq(reviewPeriod.storyId, story.id)).where(and(
      eq(reviewPeriod.id, lease.entityId), eq(reviewPeriod.familyId, lease.familyId),
      eq(story.id, period.storyId!), eq(story.familyId, lease.familyId), eq(story.status, "draft"), isNull(story.editedAt),
    )).get();
    if (!live) return;
    tx.delete(storyParagraph).where(and(eq(storyParagraph.storyId, live.id), eq(storyParagraph.familyId, lease.familyId))).run();
    plans.forEach((plan, position) => {
      const paragraphId = randomUUID();
      const now = new Date();
      tx.insert(storyParagraph).values({
        id: paragraphId, familyId: lease.familyId, storyId: live.id, position,
        kind: plan.kind, text: plan.text, createdAt: now, updatedAt: now,
      }).run();
      for (const source of plan.sources) tx.insert(storySource).values({
        id: randomUUID(), familyId: lease.familyId, paragraphId,
        sourceType: source.sourceType, sourceId: source.sourceId, quote: source.quote, createdAt: now,
      }).run();
    });
    tx.update(story).set({ createdByJobId: finalize.jobId, updatedAt: new Date() }).where(eq(story.id, live.id)).run();
  } };
};
