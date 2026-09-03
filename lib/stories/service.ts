import { randomUUID } from "node:crypto";
import { isNull, and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/db";
import { contribution as contributionTable, fact as factTable } from "@/db/schema/contribution";
import { memoryEvent, memoryEventAsset } from "@/db/schema/memory";
import { assetTranscript } from "@/db/schema/transcript";
import {
  story,
  storyParagraph,
  storySource,
  type StoryRow,
  type StoryParagraphRow,
  type StorySourceRow,
} from "@/db/schema/story";
import { assertFamilyCapability } from "@/lib/authz/policy";
import { indexStory, removeFromSearchIndex } from "@/lib/search/service";
import type { FamilyContext } from "@/lib/family/context";

/**
 * Story 服务（M4）：周记 / 月章 / 年章的草稿 → 编辑 → 发布生命周期。
 *
 * 铁律（服务层强制，不靠 prompt）：
 * 1. Quote Lock —— kind='quote' 的段落文本必须与其 contribution/transcript
 *    来源的当前文本逐字一致；quote 段落创建后不可编辑（只能删除重加）。
 * 2. 生成输入只允许 user_confirmed Fact、family 可见 Contribution、
 *    用户修订 Transcript、手写文字；ai_suggested Fact 永不进入故事。
 * 3. 再生保护 —— regenerate 绝不覆盖 editedAt != null 或 published 的故事。
 */

export const STORY_KINDS = ["weekly", "monthly", "yearly"] as const;
export type StoryKind = (typeof STORY_KINDS)[number];

export const MAX_PARAGRAPH_CHARS = 2_000;
export const MAX_PARAGRAPHS_PER_STORY = 100;
const MAX_STORIES_PER_FAMILY = 500;

export type StoryPeriod = { start: Date; end: Date };

/** 依据 kind 与锚点日期计算覆盖窗口（[start, end)，家庭时区语义由调用方传入锚点）。 */
export function periodForKind(kind: StoryKind, anchor: Date): StoryPeriod {
  const d = new Date(anchor);
  if (kind === "weekly") {
    const start = new Date(d);
    start.setUTCHours(0, 0, 0, 0);
    const day = start.getUTCDay(); // 0=周日；以周一为一周起点
    const diff = (day + 6) % 7;
    start.setUTCDate(start.getUTCDate() - diff);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return { start, end };
  }
  if (kind === "monthly") {
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    return { start, end };
  }
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const end = new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1));
  return { start, end };
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function isVerbatimQuote(haystack: string, needle: string): boolean {
  return normalizeWhitespace(haystack).includes(normalizeWhitespace(needle));
}

export type StoryDetail = {
  story: StoryRow;
  paragraphs: Array<StoryParagraphRow & { sources: StorySourceRow[] }>;
};

export async function listStories(familyId: string): Promise<
  Array<StoryRow & { paragraphCount: number }>
> {
  const db = getDb();
  const rows = db
    .select()
    .from(story)
    .where(and(eq(story.familyId, familyId), isNull(story.deletedAt)))
    .orderBy(asc(story.periodStart), asc(story.createdAt))
    .all()
    .slice(0, MAX_STORIES_PER_FAMILY);
  if (rows.length === 0) return [];
  const counts = db
    .select({ storyId: storyParagraph.storyId, id: storyParagraph.id })
    .from(storyParagraph)
    .where(
      inArray(
        storyParagraph.storyId,
        rows.map((r) => r.id),
      ),
    )
    .all();
  const countByStory = new Map<string, number>();
  for (const row of counts) {
    countByStory.set(row.storyId, (countByStory.get(row.storyId) ?? 0) + 1);
  }
  return rows.map((r) => ({ ...r, paragraphCount: countByStory.get(r.id) ?? 0 }));
}

export async function getStory(
  familyId: string,
  storyId: string,
): Promise<StoryDetail | undefined> {
  const db = getDb();
  const storyRow = db
    .select()
    .from(story)
    .where(
      and(
        eq(story.id, storyId),
        eq(story.familyId, familyId),
        isNull(story.deletedAt),
      ),
    )
    .limit(1)
    .get();
  if (!storyRow) return undefined;
  const paragraphs = db
    .select()
    .from(storyParagraph)
    .where(eq(storyParagraph.storyId, storyId))
    .orderBy(asc(storyParagraph.position))
    .all();
  const sources =
    paragraphs.length > 0
      ? db
          .select()
          .from(storySource)
          .where(
            inArray(
              storySource.paragraphId,
              paragraphs.map((p) => p.id),
            ),
          )
          .all()
      : [];
  const sourcesByParagraph = new Map<string, StorySourceRow[]>();
  for (const source of sources) {
    const list = sourcesByParagraph.get(source.paragraphId) ?? [];
    list.push(source);
    sourcesByParagraph.set(source.paragraphId, list);
  }
  return {
    story: storyRow,
    paragraphs: paragraphs.map((p) => ({
      ...p,
      sources: sourcesByParagraph.get(p.id) ?? [],
    })),
  };
}

// ---- 生成输入（对全体读者一致的安全来源集） ----

export type StorySourceMaterial = {
  facts: Array<{
    factId: string;
    statement: string;
    eventId: string;
    occurredAt: Date;
  }>;
  contributions: Array<{
    contributionId: string;
    text: string;
    eventId: string;
    occurredAt: Date;
    authorPersonId: string;
  }>;
  transcripts: Array<{
    transcriptId: string;
    text: string;
    eventId: string;
    occurredAt: Date;
  }>;
  eventTitles: Map<string, { title: string; occurredAt: Date }>;
};

/**
 * 收集一个周期内的故事素材：只取 family 可见讲述（private/parents/child_later
 * 一律不进故事，保证任何读者看到的已发布故事一致）、user_confirmed 事实、
 * 用户修订转录。ai_suggested 事实永不入选。
 */
export function collectStoryMaterial(
  familyId: string,
  period: StoryPeriod,
): StorySourceMaterial {
  const db = getDb();
  const events = db
    .select({ id: memoryEvent.id, title: memoryEvent.title, occurredAt: memoryEvent.occurredAt })
    .from(memoryEvent)
    .where(
      and(
        eq(memoryEvent.familyId, familyId),
        isNull(memoryEvent.deletedAt),
        gte(memoryEvent.occurredAt, period.start),
        lt(memoryEvent.occurredAt, period.end),
      ),
    )
    .all();
  const eventIds = events.map((e) => e.id);
  const eventTitles = new Map(
    events.map((e) => [e.id, { title: e.title, occurredAt: e.occurredAt }]),
  );

  const facts =
    eventIds.length > 0
      ? db
          .select({
            factId: factTable.id,
            statement: factTable.statement,
            eventId: factTable.memoryEventId,
          })
          .from(factTable)
          .where(
            and(
              inArray(factTable.memoryEventId, eventIds),
              eq(factTable.status, "user_confirmed"),
            ),
          )
          .all()
          .map((f) => ({
            ...f,
            occurredAt: eventTitles.get(f.eventId)?.occurredAt ?? period.start,
          }))
      : [];

  const contributions =
    eventIds.length > 0
      ? db
          .select({
            contributionId: contributionTable.id,
            rawText: contributionTable.rawText,
            editedText: contributionTable.editedText,
            eventId: contributionTable.memoryEventId,
            authorPersonId: contributionTable.authorPersonId,
          })
          .from(contributionTable)
          .where(
            and(
              inArray(contributionTable.memoryEventId, eventIds),
              eq(contributionTable.visibility, "family"),
              isNull(contributionTable.deletedAt),
            ),
          )
          .all()
          .map((c) => ({
            contributionId: c.contributionId,
            text: (c.editedText ?? c.rawText ?? "").trim(),
            eventId: c.eventId,
            occurredAt: eventTitles.get(c.eventId)?.occurredAt ?? period.start,
            authorPersonId: c.authorPersonId,
          }))
          .filter((c) => c.text.length > 0)
      : [];

  // 转录素材需要 asset→event 映射，由 collectTranscriptMaterial 单独收集
  return { facts, contributions, transcripts: [], eventTitles };
}

/** 转录素材需要 asset→event 映射，单独收集。 */
export function collectTranscriptMaterial(
  familyId: string,
  period: StoryPeriod,
): StorySourceMaterial["transcripts"] {
  const db = getDb();
  const events = db
    .select({ id: memoryEvent.id, occurredAt: memoryEvent.occurredAt })
    .from(memoryEvent)
    .where(
      and(
        eq(memoryEvent.familyId, familyId),
        isNull(memoryEvent.deletedAt),
        gte(memoryEvent.occurredAt, period.start),
        lt(memoryEvent.occurredAt, period.end),
      ),
    )
    .all();
  if (events.length === 0) return [];
  const links = db
    .select({ assetId: memoryEventAsset.assetId, eventId: memoryEventAsset.memoryEventId })
    .from(memoryEventAsset)
    .where(
      inArray(
        memoryEventAsset.memoryEventId,
        events.map((e) => e.id),
      ),
    )
    .all();
  const eventByAsset = new Map(links.map((l) => [l.assetId, l.eventId]));
  const occurredByEvent = new Map(events.map((e) => [e.id, e.occurredAt]));
  const rows = db
    .select()
    .from(assetTranscript)
    .where(eq(assetTranscript.familyId, familyId))
    .all();
  const result: StorySourceMaterial["transcripts"] = [];
  for (const t of rows) {
    const text = (t.editedTranscript ?? "").trim();
    if (!text) continue;
    const eventId = eventByAsset.get(t.assetId);
    if (!eventId || !occurredByEvent.has(eventId)) continue;
    result.push({
      transcriptId: t.id,
      text,
      eventId,
      occurredAt: occurredByEvent.get(eventId)!,
    });
  }
  return result;
}

// ---- 草稿创建（确定性，无 AI 也可用） ----

export type CreateDraftResult =
  | { ok: true; storyId: string }
  | { ok: false; error: string };

export type DraftParagraphPlan = {
  kind: "narrative" | "quote";
  text: string;
  sources: Array<{
    sourceType: "fact" | "contribution" | "transcript";
    sourceId: string;
    quote: string | null;
  }>;
};

/** 确定性组装：按时间排序，确认事实为叙述段、讲述为引文段（逐字引用）。 */
export function planDeterministicDraft(
  material: StorySourceMaterial,
  transcripts: StorySourceMaterial["transcripts"],
): DraftParagraphPlan[] {
  const items: Array<{ at: Date; plan: DraftParagraphPlan }> = [];
  for (const f of material.facts) {
    items.push({
      at: f.occurredAt,
      plan: {
        kind: "narrative",
        text: f.statement,
        sources: [{ sourceType: "fact", sourceId: f.factId, quote: null }],
      },
    });
  }
  for (const c of material.contributions) {
    items.push({
      at: c.occurredAt,
      plan: {
        kind: "quote",
        text: c.text.slice(0, MAX_PARAGRAPH_CHARS),
        sources: [
          { sourceType: "contribution", sourceId: c.contributionId, quote: c.text.slice(0, MAX_PARAGRAPH_CHARS) },
        ],
      },
    });
  }
  for (const t of transcripts) {
    items.push({
      at: t.occurredAt,
      plan: {
        kind: "quote",
        text: t.text.slice(0, MAX_PARAGRAPH_CHARS),
        sources: [
          { sourceType: "transcript", sourceId: t.transcriptId, quote: t.text.slice(0, MAX_PARAGRAPH_CHARS) },
        ],
      },
    });
  }
  items.sort((a, b) => a.at.getTime() - b.at.getTime());
  return items.map((i) => i.plan).slice(0, MAX_PARAGRAPHS_PER_STORY);
}

function defaultStoryTitle(kind: StoryKind, period: StoryPeriod): string {
  const year = period.start.getUTCFullYear();
  if (kind === "yearly") return `${year} 年的故事`;
  if (kind === "monthly") {
    const month = period.start.getUTCMonth() + 1;
    return `${year} 年 ${month} 月的故事`;
  }
  const m = String(period.start.getUTCMonth() + 1).padStart(2, "0");
  const d = String(period.start.getUTCDate()).padStart(2, "0");
  return `${m}/${d} 那一周的故事`;
}

/** 引文锁的服务端验证：quote 段落文本必须能在指定来源的当前文本中逐字找到。 */
function verifyQuoteLock(
  plan: DraftParagraphPlan,
  material: StorySourceMaterial,
  transcripts: StorySourceMaterial["transcripts"],
): boolean {
  if (plan.kind !== "quote") {
    // 叙述段禁止携带引号样式（「」与 “” 均视为引号标记）
    if (/[「」“”]/u.test(plan.text)) return false;
    return true;
  }
  for (const source of plan.sources) {
    if (source.sourceType === "contribution") {
      const row = material.contributions.find(
        (c) => c.contributionId === source.sourceId,
      );
      if (row && isVerbatimQuote(row.text, plan.text)) return true;
    }
    if (source.sourceType === "transcript") {
      const row = transcripts.find((t) => t.transcriptId === source.sourceId);
      if (row && isVerbatimQuote(row.text, plan.text)) return true;
    }
  }
  return false;
}

export function createStoryDraft(
  context: FamilyContext,
  input: { kind: StoryKind; anchor: Date; title?: string; createdByJobId?: string },
  paragraphs: DraftParagraphPlan[],
): CreateDraftResult {
  try {
    assertFamilyCapability(context.role, "story:write");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!STORY_KINDS.includes(input.kind)) {
    return { ok: false, error: "invalid_kind" };
  }
  if (paragraphs.length === 0) {
    return { ok: false, error: "no_material" };
  }
  if (paragraphs.length > MAX_PARAGRAPHS_PER_STORY) {
    paragraphs = paragraphs.slice(0, MAX_PARAGRAPHS_PER_STORY);
  }
  const period = periodForKind(input.kind, input.anchor);
  const db = getDb();

  const storyId = randomUUID();
  const now = new Date();
  db.transaction((tx) => {
    tx.insert(story)
      .values({
        id: storyId,
        familyId: context.familyId,
        kind: input.kind,
        periodStart: period.start,
        periodEnd: period.end,
        title: (input.title?.trim() || defaultStoryTitle(input.kind, period)).slice(0, 100),
        status: "draft",
        editedAt: null,
        publishedAt: null,
        publishedByUserId: null,
        createdByJobId: input.createdByJobId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    paragraphs.forEach((plan, index) => {
      const paragraphId = randomUUID();
      tx.insert(storyParagraph)
        .values({
          id: paragraphId,
          familyId: context.familyId,
          storyId,
          position: index,
          kind: plan.kind,
          text: plan.text.slice(0, MAX_PARAGRAPH_CHARS),
          createdAt: now,
          updatedAt: now,
        })
        .run();
      for (const source of plan.sources) {
        tx.insert(storySource)
          .values({
            id: randomUUID(),
            familyId: context.familyId,
            paragraphId,
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            quote: source.quote,
            createdAt: now,
          })
          .run();
      }
    });
  });
  return { ok: true, storyId };
}

export type RegenerateResult =
  | { ok: true; storyId: string; replacedDraft: boolean }
  | { ok: false; error: string };

/**
 * 再生成：未编辑（editedAt IS NULL 且 status='draft'）的同窗口草稿被替换；
 * 已编辑或已发布的版本永不触碰，新草稿另立。
 */
export function regenerateOrCreateStory(
  context: FamilyContext,
  input: { kind: StoryKind; anchor: Date; title?: string; createdByJobId?: string },
  paragraphs: DraftParagraphPlan[],
): RegenerateResult {
  const db = getDb();
  const period = periodForKind(input.kind, input.anchor);
  const existing = db
    .select()
    .from(story)
    .where(
      and(
        eq(story.familyId, context.familyId),
        eq(story.kind, input.kind),
        eq(story.periodStart, period.start),
        eq(story.status, "draft"),
      ),
    )
    .all();
  const untouched = existing.find((s) => s.editedAt === null);
  if (untouched) {
    db.delete(story).where(eq(story.id, untouched.id)).run();
    removeFromSearchIndex("story", untouched.id);
  }
  const created = createStoryDraft(context, input, paragraphs);
  if (!created.ok) return created;
  return { ok: true, storyId: created.storyId, replacedDraft: Boolean(untouched) };
}

// ---- 编辑（触发再生保护）与发布 ----

export type MutationResult = { ok: true } | { ok: false; error: string };

type DbTx = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];

function touchEdited(tx: DbTx, familyId: string, storyId: string): void {
  const now = new Date();
  tx.update(story)
    .set({ editedAt: now, updatedAt: now })
    .where(and(eq(story.id, storyId), eq(story.familyId, familyId)))
    .run();
}

export function updateStoryTitle(
  context: FamilyContext,
  storyId: string,
  title: string,
): MutationResult {
  try {
    assertFamilyCapability(context.role, "story:write");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > 100) {
    return { ok: false, error: "invalid_title" };
  }
  const db = getDb();
  const row = db
    .select({ id: story.id, status: story.status })
    .from(story)
    .where(and(eq(story.id, storyId), eq(story.familyId, context.familyId)))
    .get();
  if (!row) return { ok: false, error: "not_found" };
  if (row.status === "published") return { ok: false, error: "published_immutable" };
  db.transaction((tx) => {
    tx.update(story)
      .set({ title: trimmed, updatedAt: new Date() })
      .where(eq(story.id, storyId))
      .run();
    touchEdited(tx, context.familyId, storyId);
  });
  return { ok: true };
}

/** 叙述段可自由编辑；引文段落一经创建不可编辑（Quote Lock，只能删除后重加）。 */
export function updateParagraphText(
  context: FamilyContext,
  paragraphId: string,
  text: string,
): MutationResult {
  try {
    assertFamilyCapability(context.role, "story:write");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_PARAGRAPH_CHARS) {
    return { ok: false, error: "invalid_text" };
  }
  if (/[「」“”]/u.test(trimmed)) {
    return { ok: false, error: "quote_characters_not_allowed" };
  }
  const db = getDb();
  const paragraph = db
    .select()
    .from(storyParagraph)
    .where(
      and(
        eq(storyParagraph.id, paragraphId),
        eq(storyParagraph.familyId, context.familyId),
      ),
    )
    .get();
  if (!paragraph) return { ok: false, error: "not_found" };
  if (paragraph.kind === "quote") {
    return { ok: false, error: "quote_paragraph_immutable" };
  }
  const storyRow = db.select().from(story).where(eq(story.id, paragraph.storyId)).get();
  if (!storyRow) return { ok: false, error: "not_found" };
  if (storyRow.status === "published") {
    return { ok: false, error: "published_immutable" };
  }
  db.transaction((tx) => {
    tx.update(storyParagraph)
      .set({ text: trimmed, updatedAt: new Date() })
      .where(eq(storyParagraph.id, paragraphId))
      .run();
    touchEdited(tx, context.familyId, paragraph.storyId);
  });
  return { ok: true };
}

export function deleteParagraph(
  context: FamilyContext,
  paragraphId: string,
): MutationResult {
  try {
    assertFamilyCapability(context.role, "story:write");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const db = getDb();
  const paragraph = db
    .select()
    .from(storyParagraph)
    .where(
      and(
        eq(storyParagraph.id, paragraphId),
        eq(storyParagraph.familyId, context.familyId),
      ),
    )
    .get();
  if (!paragraph) return { ok: false, error: "not_found" };
  const storyRow = db.select().from(story).where(eq(story.id, paragraph.storyId)).get();
  if (!storyRow) return { ok: false, error: "not_found" };
  if (storyRow.status === "published") {
    return { ok: false, error: "published_immutable" };
  }
  db.transaction((tx) => {
    tx.delete(storyParagraph).where(eq(storyParagraph.id, paragraphId)).run();
    touchEdited(tx, context.familyId, paragraph.storyId);
  });
  return { ok: true };
}

/** 手写新段落（sourceType 固定 user_text；禁止引号字符以维持 Quote Lock）。 */
export function addManualParagraph(
  context: FamilyContext,
  storyId: string,
  text: string,
): MutationResult {
  try {
    assertFamilyCapability(context.role, "story:write");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_PARAGRAPH_CHARS) {
    return { ok: false, error: "invalid_text" };
  }
  if (/[「」“”]/u.test(trimmed)) {
    return { ok: false, error: "quote_characters_not_allowed" };
  }
  const db = getDb();
  const storyRow = db
    .select()
    .from(story)
    .where(and(eq(story.id, storyId), eq(story.familyId, context.familyId)))
    .get();
  if (!storyRow) return { ok: false, error: "not_found" };
  if (storyRow.status === "published") {
    return { ok: false, error: "published_immutable" };
  }
  const count = db
    .select({ id: storyParagraph.id })
    .from(storyParagraph)
    .where(eq(storyParagraph.storyId, storyId))
    .all().length;
  if (count >= MAX_PARAGRAPHS_PER_STORY) {
    return { ok: false, error: "too_many_paragraphs" };
  }
  const now = new Date();
  db.transaction((tx) => {
    const paragraphId = randomUUID();
    tx.insert(storyParagraph)
      .values({
        id: paragraphId,
        familyId: context.familyId,
        storyId,
        position: count,
        kind: "narrative",
        text: trimmed,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(storySource)
      .values({
        id: randomUUID(),
        familyId: context.familyId,
        paragraphId,
        sourceType: "user_text",
        sourceId: null,
        quote: null,
        createdAt: now,
      })
      .run();
    touchEdited(tx, context.familyId, storyId);
  });
  return { ok: true };
}

/** 发布：必须至少一个段落；发布后进入搜索索引并随 archive 导出。 */
export function publishStory(context: FamilyContext, storyId: string): MutationResult {
  try {
    assertFamilyCapability(context.role, "story:write");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const db = getDb();
  const storyRow = db
    .select()
    .from(story)
    .where(and(eq(story.id, storyId), eq(story.familyId, context.familyId)))
    .get();
  if (!storyRow) return { ok: false, error: "not_found" };
  if (storyRow.status === "published") return { ok: true };
  const paragraphs = db
    .select({ id: storyParagraph.id })
    .from(storyParagraph)
    .where(eq(storyParagraph.storyId, storyId))
    .all();
  if (paragraphs.length === 0) return { ok: false, error: "empty_story" };

  const now = new Date();
  db.update(story)
    .set({
      status: "published",
      publishedAt: now,
      publishedByUserId: context.userId,
      updatedAt: now,
    })
    .where(eq(story.id, storyId))
    .run();

  const bodyText = db
    .select({ text: storyParagraph.text })
    .from(storyParagraph)
    .where(eq(storyParagraph.storyId, storyId))
    .all()
    .map((p) => p.text)
    .join("\n");
  indexStory({
    id: storyRow.id,
    familyId: context.familyId,
    title: storyRow.title,
    bodyText,
  });
  return { ok: true };
}

// ---- 导出用查询（edited/published 才是 durable） ----

export function isStoryDurable(row: StoryRow): boolean {
  return row.status === "published" || row.editedAt !== null;
}

/** 供导出/重建使用：收集 durable 故事及其段落与来源。 */
export function collectDurableStories(familyId: string): {
  stories: StoryRow[];
  paragraphs: StoryParagraphRow[];
  sources: StorySourceRow[];
} {
  const db = getDb();
  const stories = db
    .select()
    .from(story)
    .where(and(eq(story.familyId, familyId), isNull(story.deletedAt)))
    .all()
    .filter(isStoryDurable);
  if (stories.length === 0) return { stories: [], paragraphs: [], sources: [] };
  const paragraphs = db
    .select()
    .from(storyParagraph)
    .where(
      inArray(
        storyParagraph.storyId,
        stories.map((s) => s.id),
      ),
    )
    .all();
  const sources =
    paragraphs.length > 0
      ? db
          .select()
          .from(storySource)
          .where(
            inArray(
              storySource.paragraphId,
              paragraphs.map((p) => p.id),
            ),
          )
          .all()
      : [];
  return { stories, paragraphs, sources };
}

export { verifyQuoteLock };

// ---- AI 生成入队（worker 处理；无 AI 能力时 UI 走确定性草稿） ----

import {
  enqueueAiJob,
  type AiJobServiceDependencies,
} from "@/lib/ai/jobs";

export type StoryGenerationRequestResult =
  | { ok: true; jobId: string; created: boolean }
  | { ok: false; error: string };

export function requestStoryGeneration(
  context: FamilyContext,
  input: { kind: StoryKind; anchor: Date },
  options: AiJobServiceDependencies & { now?: Date } = {},
): StoryGenerationRequestResult {
  try {
    assertFamilyCapability(context.role, "ai:review");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!STORY_KINDS.includes(input.kind)) {
    return { ok: false, error: "invalid_kind" };
  }
  // 以周期内事件作为 job 来源（漂移检测 + 非空约束）
  const period = periodForKind(input.kind, input.anchor);
  const eventIds = getDb()
    .select({ id: memoryEvent.id })
    .from(memoryEvent)
    .where(
      and(
        eq(memoryEvent.familyId, context.familyId),
        gte(memoryEvent.occurredAt, period.start),
        lt(memoryEvent.occurredAt, period.end),
      ),
    )
    .all()
    .map((r) => r.id);
  if (eventIds.length === 0) {
    return { ok: false, error: "no_story_material" };
  }
  const entityId = `${input.kind}@${input.anchor.toISOString()}`;
  return enqueueAiJob(
    {
      familyId: context.familyId,
      requestedByUserId: context.userId,
      jobType: "generate.story.v1",
      entityType: "story",
      entityId,
      requiredCapability: "text",
      triggerMode: "manual",
      sources: eventIds.map((id) => ({ kind: "memory_event", id })),
    },
    options,
  );
}
