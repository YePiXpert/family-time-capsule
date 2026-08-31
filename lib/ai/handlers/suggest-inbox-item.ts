import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { asset as assetTable } from "@/db/schema/asset";
import { person as personTable } from "@/db/schema/family";
import { inboxItem, inboxItemAsset } from "@/db/schema/inbox";
import { aiSuggestion } from "@/db/schema/suggestion";
import { assetAnalysis } from "@/db/schema/analysis";
import { assetTranscript } from "@/db/schema/transcript";
import { AiJobHandlerError, type AiJobHandler } from "@/jobs/types";

const MAX_ASSETS = 10;
const MAX_TOTAL_CONTEXT_CHARS = 12_000;
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
  rawText: string | null;
  assets: {
    id: string;
    filename: string;
    capturedAt: string | null;
    timeSource: string;
    transcripts: { rawTranscript: string | null; editedTranscript: string | null }[];
    analyses: { description: string; ocrText: string | null }[];
  }[];
  people: { displayName: string }[];
}): string {
  const lines: string[] = [];
  lines.push("你正在帮助整理一份家庭时间胶囊中的收件箱条目。请仅根据下面提供的本条资料生成建议，不要编造。");
  lines.push("");

  if (context.rawText) {
    lines.push("文字记录：");
    lines.push(context.rawText);
    lines.push("");
  }

  if (context.assets.length > 0) {
    lines.push("素材资料：");
    for (const asset of context.assets) {
      lines.push(`[素材 ${asset.id}] ${asset.filename}`);
      if (asset.capturedAt) {
        lines.push(`- 时间：${asset.capturedAt}（来源：${asset.timeSource}）`);
      }
      for (const t of asset.transcripts) {
        const text = t.editedTranscript ?? t.rawTranscript ?? "";
        if (text) lines.push(`- 转录：${text}`);
      }
      for (const a of asset.analyses) {
        lines.push(`- 视觉描述：${a.description}`);
        if (a.ocrText) lines.push(`- 图中文字：${a.ocrText}`);
      }
    }
    lines.push("");
  }

  lines.push(`家庭成员：${context.people.map((p) => p.displayName).join("、") || "（未提供）"}`);
  lines.push("");

  lines.push("输出要求：");
  lines.push("- 严格返回 JSON 对象，不要添加任何 JSON 之外的解释或 Markdown 代码块。");
  lines.push('- JSON 格式：{ "title": string|null, "occurredAt": string|null (ISO 8601 UTC), "timePrecision": "exact"|"approximate"|"date_only", "personNames": string[], "tags": string[] }');
  lines.push("- title：只有当资料能明确归纳出一件事时才给出简短标题；否则 null。");
  lines.push("- occurredAt：推断「事件发生时间」。只有当资料（如 EXIF、文件时间或文字描述）强烈指示具体发生时间时才给出 ISO 8601 UTC 时间；否则 null。不要复述拍摄时间以外的猜测。");
  lines.push("- timePrecision：exact=资料中有精确到时分的时间依据；approximate=只能推断大致时段；date_only=只有日期没有时分。不确定时一律用 approximate 或 date_only，禁止把推断写成 exact。");
  lines.push("- personNames：只能从「家庭成员」列表中选取，不要添加列表外的人。");
  lines.push("- tags：给出 0–10 个有助于归类的事件标签，每个不超过 20 字。");
  lines.push("- 禁止编造资料中没有的信息。");

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

function validatePayload(value: unknown): value is {
  title: string | null;
  occurredAt: string | null;
  timePrecision: unknown;
  personNames: string[];
  tags: string[];
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if (obj.title !== null && typeof obj.title !== "string") return false;
  if (obj.occurredAt != null && typeof obj.occurredAt !== "string") return false;
  if (!Array.isArray(obj.personNames) || !obj.personNames.every((n) => typeof n === "string")) return false;
  if (!Array.isArray(obj.tags) || !obj.tags.every((t) => typeof t === "string")) return false;
  return true;
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export const suggestInboxItemHandler: AiJobHandler = async ({ lease, assistant, signal }) => {
  const db = getDb();

  const item = await db
    .select()
    .from(inboxItem)
    .where(
      and(
        eq(inboxItem.id, lease.entityId),
        eq(inboxItem.familyId, lease.familyId),
      ),
    )
    .limit(1)
    .get();
  if (!item) {
    throw new AiJobHandlerError("inbox_item_not_found", false);
  }
  if (!["new", "needs_review", "processing"].includes(item.status)) {
    throw new AiJobHandlerError("inbox_item_closed", false);
  }

  const links = await db
    .select({ assetId: inboxItemAsset.assetId })
    .from(inboxItemAsset)
    .where(eq(inboxItemAsset.inboxItemId, item.id));
  const assetIds = links.map((l) => l.assetId);

  const originalAssets =
    assetIds.length > 0
      ? await db
          .select()
          .from(assetTable)
          .where(
            and(
              eq(assetTable.familyId, lease.familyId),
              inArray(assetTable.id, assetIds),
              inArray(assetTable.type, ["image", "video", "audio"]),
              isNull(assetTable.originalAssetId),
            ),
          )
      : [];

  const originals = originalAssets;
  const cappedAssetIds = originals.slice(0, MAX_ASSETS).map((a) => a.id);

  const [people, analyses, transcripts] = await Promise.all([
    db
      .select({ id: personTable.id, displayName: personTable.displayName })
      .from(personTable)
      .where(eq(personTable.familyId, lease.familyId)),
    cappedAssetIds.length
      ? db
          .select({
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
    cappedAssetIds.length
      ? db
          .select({
            assetId: assetTranscript.assetId,
            rawTranscript: assetTranscript.rawTranscript,
            editedTranscript: assetTranscript.editedTranscript,
          })
          .from(assetTranscript)
          .where(
            and(
              eq(assetTranscript.familyId, lease.familyId),
              inArray(assetTranscript.assetId, cappedAssetIds),
            ),
          )
      : Promise.resolve([]),
  ]);

  const analysesByAsset = new Map<string, typeof analyses>();
  for (const a of analyses) {
    const list = analysesByAsset.get(a.assetId) ?? [];
    list.push(a);
    analysesByAsset.set(a.assetId, list);
  }
  const transcriptsByAsset = new Map<string, typeof transcripts>();
  for (const t of transcripts) {
    const list = transcriptsByAsset.get(t.assetId) ?? [];
    list.push(t);
    transcriptsByAsset.set(t.assetId, list);
  }

  type AssetContextPart = {
    id: string;
    filename: string;
    capturedAt: string | null;
    timeSource: string;
    transcripts: { rawTranscript: string | null; editedTranscript: string | null }[];
    analyses: { description: string; ocrText: string | null }[];
  };
  let assetContextParts: AssetContextPart[] = originals.slice(0, MAX_ASSETS).map((asset) => ({
    id: asset.id,
    filename: asset.originalFilename,
    capturedAt: safeIso(asset.capturedAt),
    timeSource: asset.timeSource,
    transcripts: (transcriptsByAsset.get(asset.id) ?? []).map((t) => ({
      rawTranscript: t.rawTranscript,
      editedTranscript: t.editedTranscript,
    })),
    analyses: (analysesByAsset.get(asset.id) ?? []).map((a) => ({
      description: a.description,
      ocrText: a.ocrText,
    })),
  }));

  // 上下文截断
  const contextParts = [
    item.rawText ?? "",
    ...people.map((p) => p.displayName),
    ...assetContextParts.flatMap((a) => [
      a.filename,
      a.capturedAt ?? "",
      a.timeSource,
      ...a.transcripts.flatMap((t) => [t.rawTranscript ?? "", t.editedTranscript ?? ""]),
      ...a.analyses.flatMap((an) => [an.description, an.ocrText ?? ""]),
    ]),
  ];
  if (totalContextChars(contextParts) > MAX_TOTAL_CONTEXT_CHARS) {
    const base = [item.rawText ?? "", ...people.map((p) => p.displayName)];
    const allowed = MAX_TOTAL_CONTEXT_CHARS - totalContextChars(base);
    assetContextParts = assetContextParts.map((a) => ({
      ...a,
      transcripts: a.transcripts.map((t) => ({
        rawTranscript: t.rawTranscript
          ? trunc(t.rawTranscript, Math.max(50, Math.floor(allowed / Math.max(1, a.transcripts.length))))
          : null,
        editedTranscript: t.editedTranscript
          ? trunc(t.editedTranscript, Math.max(50, Math.floor(allowed / Math.max(1, a.transcripts.length))))
          : null,
      })),
      analyses: a.analyses.map((an) => ({
        description: trunc(an.description, Math.max(50, Math.floor(allowed / Math.max(1, a.analyses.length)))),
        ocrText: an.ocrText
          ? trunc(an.ocrText, Math.max(50, Math.floor(allowed / Math.max(1, a.analyses.length))))
          : null,
      })),
    }));
  }

  const prompt = buildPrompt({
    rawText: item.rawText,
    assets: assetContextParts,
    people,
  });

  const result = await assistant.generateText({
    messages: [{ role: "user", content: prompt }],
    responseFormat: "json",
    signal,
  });

  let payload: {
    title: string | null;
    occurredAt: string | null;
    timePrecision: unknown;
    personNames: string[];
    tags: string[];
  };
  try {
    const raw = extractJsonObject(result.text);
    const parsed = JSON.parse(raw);
    if (!validatePayload(parsed)) {
      throw new Error("invalid payload shape");
    }
    payload = parsed;
  } catch {
    throw new AiJobHandlerError("bad_provider_output", true);
  }

  // 人名→personId
  const personNameToId = new Map(people.map((p) => [p.displayName, p.id]));
  const resolvedPersons = payload.personNames
    .map((name) => ({ name, personId: personNameToId.get(name) }))
    .filter((p): p is { name: string; personId: string } => p.personId !== undefined);

  // 标签规范化
  const normalizedTags = [...new Set(payload.tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0 && t.length <= 50))].slice(0, MAX_TAGS_PER_RUN);

  // 标题清理
  const title = payload.title?.trim() || null;
  const safeTitle = title && title.length >= 1 && title.length <= 100 ? title : null;

  // 时间清理：事件发生时间推断 + 精度（不确定的时间绝不标记 exact）
  let safeOccurredAt: string | null = null;
  let occurredAtPrecision: TimePrecision = "approximate";
  if (payload.occurredAt) {
    const d = new Date(payload.occurredAt);
    if (!Number.isNaN(d.getTime())) {
      safeOccurredAt = d.toISOString();
      occurredAtPrecision = normalizePrecision(payload.timePrecision);
    }
  }

  const sourceFingerprint = hashCanonical({
    inboxItemId: item.id,
    rawText: item.rawText,
    people: people.map((p) => ({ id: p.id, displayName: p.displayName })),
    assets: assetContextParts.map((a) => ({
      id: a.id,
      filename: a.filename,
      capturedAt: a.capturedAt,
      timeSource: a.timeSource,
      transcripts: a.transcripts,
      analyses: a.analyses,
    })),
    suggestion: {
      title: safeTitle,
      occurredAt: safeOccurredAt,
      occurredAtPrecision,
      personNames: resolvedPersons.map((p) => p.name),
      tags: normalizedTags,
    },
  });

  const provenance = result.provenance;

  return {
    commit: (tx) => {
      const now = new Date();

      tx.delete(aiSuggestion)
        .where(
          and(
            eq(aiSuggestion.familyId, lease.familyId),
            eq(aiSuggestion.entityType, "inbox_item"),
            eq(aiSuggestion.entityId, item.id),
            eq(aiSuggestion.status, "pending"),
          ),
        )
        .run();

      const suggestionsToInsert: {
        id: string;
        suggestionType: "title" | "occurred_at" | "person" | "tag";
        valueJson: string;
      }[] = [];
      if (safeTitle) {
        suggestionsToInsert.push({
          id: randomUUID(),
          suggestionType: "title",
          valueJson: JSON.stringify({ title: safeTitle }),
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
              entityType: "inbox_item" as const,
              entityId: item.id,
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
    },
  };
};
