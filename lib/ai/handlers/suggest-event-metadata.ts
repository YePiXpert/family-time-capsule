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
import {
  SourceAliasRegistry,
  formatSegmentClock,
  parseSegmentsJson,
  resolveFactSources,
  type ResolvedSourceRef,
} from "@/lib/facts/source-refs";
import { AiJobHandlerError, type AiJobHandler } from "@/jobs/types";

const MAX_ASSETS = 20;
const MAX_TRANSCRIPT_CHARS = 2_000;
const MAX_ANALYSIS_CHARS = 1_000;
const MAX_CONTRIBUTION_CHARS = 1_000;
const MAX_TOTAL_CONTEXT_CHARS = 24_000;
const MAX_FACTS_PER_RUN = 10;
const MAX_TAGS_PER_RUN = 10;
const MAX_SUGGESTIONS_PER_TYPE = 10;

const TIME_PRECISIONS = ["exact", "approximate", "date_only"] as const;
type TimePrecision = (typeof TIME_PRECISIONS)[number];

function normalizePrecision(value: unknown): TimePrecision {
  return TIME_PRECISIONS.includes(value as TimePrecision)
    ? (value as TimePrecision)
    : "approximate";
}

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
  /** 已按别名标注的来源块（T#/A#/C#）；facts 的 sources 只能引用这些别名 */
  sourceBlocks: string[];
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

  if (context.sourceBlocks.length > 0) {
    lines.push("来源资料（每块开头的 [T1]/[A1]/[C1] 等是来源别名；生成事实时只能在 sources 里引用这些别名）：");
    for (const block of context.sourceBlocks) {
      lines.push(block);
    }
    lines.push("");
  }

  if (context.existingTags.length > 0) {
    lines.push(`现有标签：${context.existingTags.join("、")}`);
    lines.push("");
  }

  lines.push("输出要求：");
  lines.push("- 严格返回 JSON 对象，不要添加任何 JSON 之外的解释或 Markdown 代码块。");
  lines.push('- JSON 格式：{ "title": string|null, "locationText": string|null, "occurredAt": string|null (ISO 8601 UTC), "timePrecision": "exact"|"approximate"|"date_only", "tags": string[], "personNames": string[], "facts": [{ "statement": string, "sources": [{ "ref": "T1", "quote": "来源原文关键句" }] }] }');
  lines.push("- title：只有当当前标题看起来像占位符（如「一段记忆」、极短无意义标题）时才给出更合适的标题；否则填 null。");
  lines.push("- locationText：如果资料能推断出明确地点，给出简短地点描述；否则 null。");
  lines.push("- occurredAt：推断「事件发生时间」（不是素材拍摄时间）。仅当资料（转录/讲述/图中文字/文件时间）强烈指示当前发生时间明显不对、且能给出更准确的时间时才给出 ISO 8601 UTC；否则 null。");
  lines.push("- timePrecision：exact=资料中有精确到时分的依据；approximate=只能推断大致时段；date_only=只有日期。不确定时禁止写 exact。");
  lines.push("- tags：给出 0–10 个有助于归类的事件标签，每个不超过 20 字。");
  lines.push("- personNames：只能从上文「家庭成员」列表中选取，不要添加列表外的人。");
  lines.push("- facts：0–10 条事实，每条包含 statement 与 sources。事实必须基于来源资料中可见/可闻的内容。");
  lines.push('- sources[].ref：只能引用来源资料中出现过的别名（T#/A#/C#），不允许编造别名，也不允许写任何其他 ID。');
  lines.push('- sources[].quote：从该来源原文中逐字摘录的关键句；无法逐字引用时省略 quote 字段。');
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
  occurredAt: string | null;
  timePrecision: unknown;
  tags: string[];
  personNames: string[];
  facts: { statement: string; sources?: unknown }[];
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (obj.title !== null && typeof obj.title !== "string") return false;
  if (obj.locationText !== null && typeof obj.locationText !== "string") return false;
  if (obj.occurredAt != null && typeof obj.occurredAt !== "string") return false;
  if (!Array.isArray(obj.tags) || !obj.tags.every((t) => typeof t === "string")) return false;
  if (!Array.isArray(obj.personNames) || !obj.personNames.every((n) => typeof n === "string")) return false;
  if (!Array.isArray(obj.facts)) return false;
  for (const f of obj.facts) {
    if (f === null || typeof f !== "object" || Array.isArray(f)) return false;
    const rec = f as Record<string, unknown>;
    if (typeof rec.statement !== "string") return false;
    if (rec.sources !== undefined && !Array.isArray(rec.sources)) return false;
  }
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
  const originalAssets = linkedAssetIds.length
    ? await db
        .select({
          id: assetTable.id,
          filename: assetTable.originalFilename,
        })
        .from(assetTable)
        .where(
          and(
            eq(assetTable.familyId, lease.familyId),
            inArray(assetTable.id, linkedAssetIds),
            isNull(assetTable.originalAssetId),
          ),
        )
        .then((rows) => rows.slice(0, MAX_ASSETS))
    : [];
  const cappedAssetIds = originalAssets.map((a) => a.id);
  const filenameByAssetId = new Map(originalAssets.map((a) => [a.id, a.filename]));

  const [transcripts, analyses] = await Promise.all([
    cappedAssetIds.length
      ? db
          .select({
            id: assetTranscript.id,
            assetId: assetTranscript.assetId,
            rawTranscript: assetTranscript.rawTranscript,
            editedTranscript: assetTranscript.editedTranscript,
            segmentsJson: assetTranscript.segmentsJson,
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
            id: assetAnalysis.id,
            assetId: assetAnalysis.assetId,
            description: assetAnalysis.description,
            ocrText: assetAnalysis.ocrText,
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

  // ---- 构建来源别名注册表与 prompt 来源块（M3-D）----
  // 真实行 ID 从不进入 prompt；模型只能看到 T#/A#/C# 别名。
  const registry = new SourceAliasRegistry();
  const sourceBlocks: string[] = [];

  let transcriptSerial = 0;
  for (const t of transcripts) {
    transcriptSerial += 1;
    const alias = `T${transcriptSerial}`;
    const fullText = trunc(
      (t.editedTranscript ?? t.rawTranscript) || "",
      MAX_TRANSCRIPT_CHARS,
    );
    if (!fullText) continue;
    const segments = parseSegmentsJson(t.segmentsJson);
    registry.register({
      alias,
      kind: "transcript",
      sourceId: t.id,
      searchText: fullText,
      segments,
      label: filenameByAssetId.get(t.assetId) ?? t.assetId,
      analysis: null,
    });
    const lines = [`[${alias}] 转录（${filenameByAssetId.get(t.assetId) ?? "素材"}）：`];
    if (segments && segments.length > 0) {
      for (const seg of segments) {
        lines.push(
          `${formatSegmentClock(seg.startSeconds)}–${formatSegmentClock(seg.endSeconds)}：${seg.text}`,
        );
      }
    } else {
      lines.push(fullText);
    }
    sourceBlocks.push(lines.join("\n"));
  }

  const analysisByAssetId = new Map<
    string,
    { id: string; description: string; ocrText: string | null }
  >();
  for (const a of analyses) {
    analysisByAssetId.set(a.assetId, a);
  }
  let assetSerial = 0;
  for (const assetId of cappedAssetIds) {
    assetSerial += 1;
    const alias = `A${assetSerial}`;
    const filename = filenameByAssetId.get(assetId) ?? "素材";
    const analysis = analysisByAssetId.get(assetId);
    const description = analysis
      ? trunc(analysis.description, MAX_ANALYSIS_CHARS)
      : null;
    const ocrText = analysis?.ocrText
      ? trunc(analysis.ocrText, MAX_ANALYSIS_CHARS)
      : null;
    registry.register({
      alias,
      kind: "asset",
      sourceId: assetId,
      // 整体素材证据不允许引文；引文只可能落到其视觉分析（见 analysis 字段）
      searchText: null,
      segments: null,
      label: filename,
      analysis:
        description || ocrText
          ? {
              searchText: [description, ocrText].filter(Boolean).join("\n"),
            }
          : null,
    });
    const lines = [`[${alias}] 素材 ${filename}${analysis ? "（AI 视觉分析，未经确认）" : ""}：`];
    if (description) lines.push(`视觉描述：${description}`);
    if (ocrText) lines.push(`图中文字：${ocrText}`);
    if (!description && !ocrText) lines.push("（无文字性内容）");
    sourceBlocks.push(lines.join("\n"));
  }

  let contributionSerial = 0;
  const contributionTexts: { id: string; text: string }[] = [];
  for (const c of visibleContributions) {
    if (c.visibility !== "family") continue;
    const text = trunc(c.editedText ?? c.rawText ?? "", MAX_CONTRIBUTION_CHARS);
    if (!text) continue;
    contributionSerial += 1;
    const alias = `C${contributionSerial}`;
    registry.register({
      alias,
      kind: "contribution",
      sourceId: c.id,
      searchText: text,
      segments: null,
      label: "家人讲述",
      analysis: null,
    });
    contributionTexts.push({ id: c.id, text });
    sourceBlocks.push(`[${alias}] 家人讲述：\n${text}`);
  }

  const confirmedFactStatements = confirmedFacts.map((f) => f.statement);
  const existingTagStrings = existingTags.map((t) => t.tag);

  // 上下文超长时整体截断来源块（从最后一块开始移除，保持最早的来源稳定）
  const baseContext = [
    eventRow.title,
    eventRow.occurredAt.toISOString(),
    ...people.map((p) => p.displayName),
    ...confirmedFactStatements,
    ...existingTagStrings,
  ];
  const contextSourceBlocks = sourceBlocks;
  while (
    totalContextChars([...baseContext, ...contextSourceBlocks]) >
      MAX_TOTAL_CONTEXT_CHARS &&
    contextSourceBlocks.length > 0
  ) {
    const removed = contextSourceBlocks.pop();
    // 移除的来源块对应的别名也必须从注册表下线，防止模型引用已不可见的来源
    if (removed) {
      const aliasMatch = removed.match(/^\[([A-Z]\d+)\]/);
      if (aliasMatch) registry.unregister(aliasMatch[1]);
    }
  }

  const prompt = buildPrompt({
    title: eventRow.title,
    occurredAt: eventRow.occurredAt.toISOString(),
    people,
    confirmedFacts: confirmedFactStatements,
    sourceBlocks: contextSourceBlocks,
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
    occurredAt: string | null;
    timePrecision: unknown;
    tags: string[];
    personNames: string[];
    facts: { statement: string; sources?: unknown }[];
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

  // 事实解析：别名映射 + 引文锁 + segment 时间推导（M3-D）。
  // 引用全部失效的事实整条丢弃——AI 永远不能产出无来源的事实。
  const cleanedFacts: { statement: string; sources: ResolvedSourceRef[] }[] = [];
  const seenStatements = new Set<string>();
  for (const f of payload.facts) {
    const statement = f.statement.trim();
    if (statement.length === 0 || statement.length > 500) continue;
    if (seenStatements.has(statement)) continue;
    const sources = resolveFactSources(registry, f.sources);
    if (sources.length === 0) continue;
    seenStatements.add(statement);
    cleanedFacts.push({ statement, sources });
    if (cleanedFacts.length >= MAX_FACTS_PER_RUN) break;
  }

  // 标题/地点/时间清理
  const title = payload.title?.trim() || null;
  const locationText = payload.locationText?.trim() || null;
  const safeTitle = title && title.length >= 1 && title.length <= 100 ? title : null;
  const safeLocation = locationText && locationText.length <= 200 ? locationText : null;

  // 事件发生时间建议：仅当与当前时间不同才值得建议；精度不明时绝不 exact
  let safeOccurredAt: string | null = null;
  let occurredAtPrecision: TimePrecision = "approximate";
  if (payload.occurredAt) {
    const d = new Date(payload.occurredAt);
    if (!Number.isNaN(d.getTime()) && d.getTime() !== eventRow.occurredAt.getTime()) {
      safeOccurredAt = d.toISOString();
      occurredAtPrecision = normalizePrecision(payload.timePrecision);
    }
  }

  // 计算来源指纹：基于实际送入模型的上下文（含别名块）
  const sourceFingerprint = hashCanonical({
    eventId: eventRow.id,
    title: eventRow.title,
    occurredAt: eventRow.occurredAt.toISOString(),
    people: people.map((p) => ({ id: p.id, displayName: p.displayName })),
    confirmedFacts: confirmedFactStatements,
    sourceBlocks: contextSourceBlocks,
    existingTags: existingTagStrings,
    suggestion: {
      title: safeTitle,
      locationText: safeLocation,
      occurredAt: safeOccurredAt,
      occurredAtPrecision,
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
        suggestionType: "title" | "location" | "occurred_at" | "person" | "tag";
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
      if (safeOccurredAt) {
        suggestionsToInsert.push({
          id: randomUUID(),
          suggestionType: "occurred_at",
          valueJson: JSON.stringify({
            occurredAt: safeOccurredAt,
            precision: occurredAtPrecision,
          }),
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

      // 插入 ai_suggested 事实及其逐条来源（含 quote / 时间 locator）
      if (cleanedFacts.length > 0) {
        const factRows = cleanedFacts.map((f) => ({
          id: randomUUID(),
          memoryEventId: eventRow.id,
          statement: f.statement,
          status: "ai_suggested" as const,
          createdAt: now,
          updatedAt: now,
        }));
        tx.insert(fact).values(factRows).run();

        const factSourcesToInsert = factRows.flatMap((row, index) =>
          cleanedFacts[index].sources.map((source) => ({
            id: randomUUID(),
            familyId: lease.familyId,
            factId: row.id,
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            quote: source.quote,
            startMs: source.startMs,
            endMs: source.endMs,
            createdAt: now,
          })),
        );
        if (factSourcesToInsert.length > 0) {
          tx.insert(factSource).values(factSourcesToInsert).run();
        }
      }
    },
  };
};
