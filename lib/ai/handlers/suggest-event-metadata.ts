import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { asset as assetTable } from "@/db/schema/asset";
import { fact } from "@/db/schema/contribution";
import { person as personTable, family as familyTable } from "@/db/schema/family";
import { user as userTable } from "@/db/schema/auth";
import {
  memoryEvent,
  memoryEventAsset,
} from "@/db/schema/memory";
import { aiSuggestion, factSource, memoryEventTag } from "@/db/schema/suggestion";
import { assetAnalysis } from "@/db/schema/analysis";
import { assetTranscript } from "@/db/schema/transcript";
import type { ContributionAccessSnapshot } from "@/lib/authz/contribution-access";
import { listVisibleContributionsForEvent } from "@/lib/authz/contribution-access";
import { isFamilyRole } from "@/lib/authz/policy";
import { familyLocalDate } from "@/lib/authz/principal";
import { AiJobHandlerError, type AiJobHandler } from "@/jobs/types";

const MAX_ASSETS = 20;
const MAX_TRANSCRIPT_CHARS = 2_000;
const MAX_ANALYSIS_CHARS = 1_000;
const MAX_CONTRIBUTION_CHARS = 1_000;
const MAX_TOTAL_CONTEXT_CHARS = 24_000;
const MAX_FACTS_PER_RUN = 10;
const MAX_TAGS_PER_RUN = 10;
const MAX_SUGGESTIONS_PER_TYPE = 10;

function trunc(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars - 1) + "…";
}

function totalContextChars(parts: string[]): number {
  return parts.reduce((sum, part) => sum + part.length, 0);
}

function buildPrompt(context: {
  title: string;
  occurredAt: string;
  people: { displayName: string }[];
  confirmedFacts: string[];
  transcripts: { assetId: string; text: string }[];
  analyses: { assetId: string; description: string; ocrText: string | null }[];
  contributions: { id: string; text: string }[];
  existingTags: string[];
}): string {
  const lines: string[] = [];
  lines.push("你正在帮助整理一份家庭时间胶囊中的记忆事件。请仅根据下面提供的本事件资料生成建议，不要编造。");
  lines.push("");
  lines.push("当前事件信息：");
  lines.push(`- 标题：${context.title}`);
  lines.push(`- 发生时间：${context.occurredAt}`);
  lines.push(`- 家庭成员：${context.people.map((p) => p.displayName).join("、") || "（未提供）"}`);
  lines.push("");

  if (context.confirmedFacts.length > 0) {
    lines.push("已确认事实（供参考，不要重复）：");
    for (const statement of context.confirmedFacts) {
      lines.push(`- ${statement}`);
    }
    lines.push("");
  }

  if (context.transcripts.length > 0) {
    lines.push("音视频转录（按素材分组）：");
    for (const t of context.transcripts) {
      lines.push(`[素材 ${t.assetId}]`);
      lines.push(t.text);
    }
    lines.push("");
  }

  if (context.analyses.length > 0) {
    lines.push("图片视觉分析（按素材分组）：");
    for (const a of context.analyses) {
      lines.push(`[素材 ${a.assetId}]`);
      lines.push(a.description);
      if (a.ocrText) {
        lines.push(`图中文字：${a.ocrText}`);
      }
    }
    lines.push("");
  }

  if (context.contributions.length > 0) {
    lines.push("家人讲述：");
    for (const c of context.contributions) {
      lines.push(c.text);
    }
    lines.push("");
  }

  if (context.existingTags.length > 0) {
    lines.push(`现有标签：${context.existingTags.join("、")}`);
    lines.push("");
  }

  lines.push("输出要求：");
  lines.push("- 严格返回 JSON 对象，不要添加任何 JSON 之外的解释或 Markdown 代码块。");
  lines.push('- JSON 格式：{ "title": string|null, "locationText": string|null, "tags": string[], "personNames": string[], "facts": string[] }');
  lines.push("- title：只有当当前标题看起来像占位符（如「一段记忆」、极短无意义标题）时才给出更合适的标题；否则填 null。");
  lines.push("- locationText：如果资料能推断出明确地点，给出简短地点描述；否则 null。");
  lines.push("- tags：给出 0–10 个有助于归类的事件标签，每个不超过 20 字。");
  lines.push("- personNames：只能从上文「家庭成员」列表中选取，不要添加列表外的人。");
  lines.push("- facts：给出 0–10 条可陈述的事实。必须是基于转录、图片分析或讲述中可见/可闻内容的 plain 陈述句。");
  lines.push("- 禁止编造引号内的原话；禁止把情绪、推测、身份、医疗诊断当作事实；禁止添加资料中没有的信息。");
  lines.push("- 如果资料不足，所有数组都可以为空。");

  return lines.join("\n");
}

function extractJsonObject(text: string): string {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("no json object found");
  }
  return text.slice(firstBrace, lastBrace + 1);
}

function validateSuggestionPayload(value: unknown): value is {
  title: string | null;
  locationText: string | null;
  tags: string[];
  personNames: string[];
  facts: string[];
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (obj.title !== null && typeof obj.title !== "string") return false;
  if (obj.locationText !== null && typeof obj.locationText !== "string") return false;
  if (!Array.isArray(obj.tags) || !obj.tags.every((t) => typeof t === "string")) return false;
  if (!Array.isArray(obj.personNames) || !obj.personNames.every((n) => typeof n === "string")) return false;
  if (!Array.isArray(obj.facts) || !obj.facts.every((f) => typeof f === "string")) return false;
  return true;
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function buildContributionAccessSnapshot(
  familyId: string,
  userId: string,
): Promise<ContributionAccessSnapshot> {
  const db = getDb();
  const row = await db
    .select({
      id: userTable.id,
      familyId: userTable.familyId,
      personId: userTable.personId,
      role: userTable.role,
      disabledAt: userTable.disabledAt,
      familyTimezone: familyTable.timezone,
      childLaterUnlockAge: familyTable.childLaterUnlockAge,
      isGuardian: personTable.isGuardian,
      boundPersonId: personTable.id,
      boundFamilyId: familyTable.id,
    })
    .from(userTable)
    .innerJoin(familyTable, eq(familyTable.id, userTable.familyId))
    .leftJoin(
      personTable,
      and(
        eq(userTable.personId, personTable.id),
        eq(personTable.familyId, userTable.familyId),
      ),
    )
    .where(eq(userTable.id, userId))
    .limit(1);
  const r = row[0];
  if (
    !r ||
    r.disabledAt !== null ||
    r.familyId !== familyId ||
    r.boundFamilyId !== familyId ||
    !isFamilyRole(r.role) ||
    r.familyTimezone === null ||
    r.childLaterUnlockAge === null ||
    (r.personId !== null && r.boundPersonId !== r.personId)
  ) {
    throw new AiJobHandlerError("authorization_revoked", false);
  }
  const now = new Date();
  return {
    principal: {
      userId: r.id,
      familyId: r.familyId,
      personId: r.personId,
      role: r.role,
      accountEnabled: true as const,
      isGuardian: r.isGuardian ?? false,
      familyTimezone: r.familyTimezone,
      childLaterUnlockAge: r.childLaterUnlockAge,
    },
    evaluatedAt: now,
    familyLocalDate: familyLocalDate(now, r.familyTimezone),
  };
}

type SourceReference =
  | { type: "asset"; id: string }
  | { type: "transcript"; id: string }
  | { type: "contribution"; id: string };

export const suggestEventMetadataHandler: AiJobHandler = async ({
  lease,
  assistant,
  signal,
}) => {
  const db = getDb();

  const event = await db
    .select()
    .from(memoryEvent)
    .where(
      and(
        eq(memoryEvent.id, lease.entityId),
        eq(memoryEvent.familyId, lease.familyId),
      ),
    )
    .limit(1);
  const eventRow = event[0];
  if (!eventRow) {
    throw new AiJobHandlerError("event_not_found", false);
  }

  // 构建贡献可见性快照（只包含当前用户可见的讲述）
  const snapshot = await buildContributionAccessSnapshot(
    lease.familyId,
    lease.requestedByUserId,
  );

  const [people, confirmedFacts, assetLinks, existingTags, visibleContributions] = await Promise.all([
    db.select({ id: personTable.id, displayName: personTable.displayName }).from(personTable).where(eq(personTable.familyId, lease.familyId)),
    db
      .select({ statement: fact.statement })
      .from(fact)
      .where(and(eq(fact.memoryEventId, eventRow.id), eq(fact.status, "user_confirmed")))
      .orderBy(fact.createdAt),
    db
      .select({ assetId: memoryEventAsset.assetId })
      .from(memoryEventAsset)
      .where(eq(memoryEventAsset.memoryEventId, eventRow.id)),
    db
      .select({ tag: memoryEventTag.tag })
      .from(memoryEventTag)
      .where(eq(memoryEventTag.memoryEventId, eventRow.id)),
    listVisibleContributionsForEvent(snapshot, eventRow.id),
  ]);

  const linkedAssetIds = assetLinks.map((l) => l.assetId);
  const originalAssetIds = linkedAssetIds.length
    ? await db
        .select({ id: assetTable.id })
        .from(assetTable)
        .where(
          and(
            eq(assetTable.familyId, lease.familyId),
            inArray(assetTable.id, linkedAssetIds),
            isNull(assetTable.originalAssetId),
          ),
        )
        .then((rows) => rows.map((r) => r.id))
    : [];
  const cappedAssetIds = originalAssetIds.slice(0, MAX_ASSETS);

  const [transcripts, analyses] = await Promise.all([
    cappedAssetIds.length
      ? db
          .select({
            assetId: assetTranscript.assetId,
            rawTranscript: assetTranscript.rawTranscript,
            editedTranscript: assetTranscript.editedTranscript,
            id: assetTranscript.id,
          })
          .from(assetTranscript)
          .where(
            and(
              eq(assetTranscript.familyId, lease.familyId),
              inArray(assetTranscript.assetId, cappedAssetIds),
            ),
          )
      : Promise.resolve([]),
    cappedAssetIds.length
      ? db
          .select({
            assetId: assetAnalysis.assetId,
            description: assetAnalysis.description,
            ocrText: assetAnalysis.ocrText,
            id: assetAnalysis.id,
          })
          .from(assetAnalysis)
          .where(
            and(
              eq(assetAnalysis.familyId, lease.familyId),
              inArray(assetAnalysis.assetId, cappedAssetIds),
            ),
          )
      : Promise.resolve([]),
  ]);

  const includedSources: SourceReference[] = [];
  for (const id of cappedAssetIds) {
    includedSources.push({ type: "asset", id });
  }
  for (const t of transcripts) {
    includedSources.push({ type: "transcript", id: t.id });
  }

  let transcriptParts = transcripts.map((t) => ({
    assetId: t.assetId,
    text: trunc((t.editedTranscript ?? t.rawTranscript) || "", MAX_TRANSCRIPT_CHARS),
  }));

  let analysisParts = analyses.map((a) => ({
    assetId: a.assetId,
    description: trunc(a.description, MAX_ANALYSIS_CHARS),
    ocrText: a.ocrText ? trunc(a.ocrText, MAX_ANALYSIS_CHARS) : null,
  }));

  let contributionParts = visibleContributions
    .filter((c) => c.visibility === "family")
    .map((c) => ({
      id: c.id,
      text: trunc(c.editedText ?? c.rawText ?? "", MAX_CONTRIBUTION_CHARS),
    }))
    .filter((c) => c.text.length > 0);
  for (const c of contributionParts) {
    includedSources.push({ type: "contribution", id: c.id });
  }

  const confirmedFactStatements = confirmedFacts.map((f) => f.statement);
  const existingTagStrings = existingTags.map((t) => t.tag);

  const contextParts = [
    eventRow.title,
    eventRow.occurredAt.toISOString(),
    ...people.map((p) => p.displayName),
    ...confirmedFactStatements,
    ...transcriptParts.flatMap((t) => [t.assetId, t.text]),
    ...analysisParts.flatMap((a) => [a.assetId, a.description, a.ocrText ?? ""]),
    ...contributionParts.map((c) => c.text),
    ...existingTagStrings,
  ];

  // 如果上下文超长，按优先级截断：先截讲述，再截分析，再截转录
  if (totalContextChars(contextParts) > MAX_TOTAL_CONTEXT_CHARS) {
    let allowed = MAX_TOTAL_CONTEXT_CHARS;
    const base = [
      eventRow.title,
      eventRow.occurredAt.toISOString(),
      ...people.map((p) => p.displayName),
      ...confirmedFactStatements,
      ...existingTagStrings,
    ];
    allowed -= totalContextChars(base);
    contributionParts = contributionParts.map((c) => ({
      ...c,
      text: trunc(c.text, Math.max(100, Math.floor(allowed / Math.max(1, contributionParts.length)))),
    }));
    analysisParts = analysisParts.map((a) => ({
      ...a,
      description: trunc(a.description, Math.max(100, Math.floor(allowed / Math.max(1, analysisParts.length)))),
      ocrText: a.ocrText ? trunc(a.ocrText, Math.max(100, Math.floor(allowed / Math.max(1, analysisParts.length)))) : null,
    }));
    transcriptParts = transcriptParts.map((t) => ({
      ...t,
      text: trunc(t.text, Math.max(100, Math.floor(allowed / Math.max(1, transcriptParts.length)))),
    }));
  }

  const prompt = buildPrompt({
    title: eventRow.title,
    occurredAt: eventRow.occurredAt.toISOString(),
    people,
    confirmedFacts: confirmedFactStatements,
    transcripts: transcriptParts,
    analyses: analysisParts,
    contributions: contributionParts,
    existingTags: existingTagStrings,
  });

  const result = await assistant.generateText({
    messages: [{ role: "user", content: prompt }],
    responseFormat: "json",
    signal,
  });

  let payload: {
    title: string | null;
    locationText: string | null;
    tags: string[];
    personNames: string[];
    facts: string[];
  };
  try {
    const raw = extractJsonObject(result.text);
    const parsed = JSON.parse(raw);
    if (!validateSuggestionPayload(parsed)) {
      throw new Error("invalid payload shape");
    }
    payload = parsed;
  } catch {
    throw new AiJobHandlerError("bad_provider_output", true);
  }

  // 人名→personId，只接受家庭成员列表中的精确匹配
  const personNameToId = new Map(people.map((p) => [p.displayName, p.id]));
  const resolvedPersons = payload.personNames
    .map((name) => ({ name, personId: personNameToId.get(name) }))
    .filter((p): p is { name: string; personId: string } => p.personId !== undefined);

  // 标签规范化
  const normalizedTags = [...new Set(payload.tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0 && t.length <= 50))].slice(0, MAX_TAGS_PER_RUN);

  // 事实去重/清理
  const cleanedFacts = payload.facts
    .map((f) => f.trim())
    .filter((f) => f.length > 0 && f.length <= 500)
    .slice(0, MAX_FACTS_PER_RUN);

  // 标题/地点清理
  const title = payload.title?.trim() || null;
  const locationText = payload.locationText?.trim() || null;
  const safeTitle = title && title.length >= 1 && title.length <= 100 ? title : null;
  const safeLocation = locationText && locationText.length <= 200 ? locationText : null;

  // 计算来源指纹：基于实际送入模型的上下文
  const sourceFingerprint = hashCanonical({
    eventId: eventRow.id,
    title: eventRow.title,
    occurredAt: eventRow.occurredAt.toISOString(),
    people: people.map((p) => ({ id: p.id, displayName: p.displayName })),
    confirmedFacts: confirmedFactStatements,
    transcripts: transcriptParts,
    analyses: analysisParts,
    contributions: contributionParts.map((c) => ({ id: c.id, text: c.text })),
    existingTags: existingTagStrings,
    suggestion: {
      title: safeTitle,
      locationText: safeLocation,
      tags: normalizedTags,
      personNames: resolvedPersons.map((p) => p.name),
      facts: cleanedFacts,
    },
  });

  const provenance = result.provenance;

  return {
    commit: (tx) => {
      const now = new Date();

      // 删除本事件之前 pending 的建议（保留 accepted/rejected 墓碑）
      tx.delete(aiSuggestion)
        .where(
          and(
            eq(aiSuggestion.familyId, lease.familyId),
            eq(aiSuggestion.entityType, "memory_event"),
            eq(aiSuggestion.entityId, eventRow.id),
            eq(aiSuggestion.status, "pending"),
          ),
        )
        .run();

      // 插入新的 pending 建议
      const suggestionsToInsert: {
        id: string;
        suggestionType: "title" | "location" | "person" | "tag";
        valueJson: string;
      }[] = [];
      if (safeTitle) {
        suggestionsToInsert.push({
          id: randomUUID(),
          suggestionType: "title",
          valueJson: JSON.stringify({ title: safeTitle }),
        });
      }
      if (safeLocation) {
        suggestionsToInsert.push({
          id: randomUUID(),
          suggestionType: "location",
          valueJson: JSON.stringify({ locationText: safeLocation }),
        });
      }
      for (const p of resolvedPersons) {
        suggestionsToInsert.push({
          id: randomUUID(),
          suggestionType: "person",
          valueJson: JSON.stringify({ personId: p.personId, personName: p.name }),
        });
      }
      for (const tag of normalizedTags) {
        suggestionsToInsert.push({
          id: randomUUID(),
          suggestionType: "tag",
          valueJson: JSON.stringify({ tag }),
        });
      }

      const cappedSuggestions = suggestionsToInsert.slice(0, MAX_SUGGESTIONS_PER_TYPE * 4);
      if (cappedSuggestions.length > 0) {
        tx.insert(aiSuggestion)
          .values(
            cappedSuggestions.map((s) => ({
              id: s.id,
              familyId: lease.familyId,
              entityType: "memory_event" as const,
              entityId: eventRow.id,
              suggestionType: s.suggestionType,
              valueJson: s.valueJson,
              provider: provenance.providerId,
              model: provenance.model,
              status: "pending" as const,
              createdByJobId: lease.jobId,
              sourceFingerprint,
              createdAt: now,
              resolvedAt: null,
              resolvedByUserId: null,
            })),
          )
          .run();
      }

      // 插入 ai_suggested 事实及其来源
      if (cleanedFacts.length > 0) {
        const factRows = cleanedFacts.map((statement) => ({
          id: randomUUID(),
          memoryEventId: eventRow.id,
          statement,
          status: "ai_suggested" as const,
          createdAt: now,
          updatedAt: now,
        }));
        tx.insert(fact).values(factRows).run();

        const factSourcesToInsert = factRows.flatMap((f) => {
          const refs: { id: string; familyId: string; factId: string; sourceType: "asset" | "contribution" | "transcript"; sourceId: string; createdAt: Date }[] = [];
          for (const source of includedSources) {
            refs.push({
              id: randomUUID(),
              familyId: lease.familyId,
              factId: f.id,
              sourceType: source.type,
              sourceId: source.id,
              createdAt: now,
            });
          }
          return refs.slice(0, MAX_SUGGESTIONS_PER_TYPE);
        });
        if (factSourcesToInsert.length > 0) {
          tx.insert(factSource).values(factSourcesToInsert).run();
        }
      }
    },
  };
};
