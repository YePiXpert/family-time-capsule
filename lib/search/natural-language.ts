import "server-only";

import type { MemoryAssistant } from "@/lib/ai/types";
import { AiCapabilityUnavailableError } from "@/lib/ai/errors";
import { getDb } from "@/db";
import { person as personTable } from "@/db/schema/family";
import { and, eq } from "drizzle-orm";
import type { FamilyContext } from "@/lib/family/context";
import type { SearchParams } from "./service";

/**
 * 自然语言辅助检索（M7 / FIND-3，白皮书 §9）：
 * 模型只做一件受限制的事——把一句中文描述转换成**受限的检索条件**
 * （关键词/同义词/人物名/年月/媒体类型），随后由服务端把这些条件映射到
 * 既有、受权限控制的 FTS 查询并返回来源卡片。
 *
 * 红线（Goal M7）：
 * - 不执行模型生成的 SQL；模型输出只允许白名单字段；
 * - 不让模型凭记忆回答家庭事实：命中结果全部来自本地索引；
 * - 无依据/解析失败 → 明确"未找到/无法转换"，不静默放宽带条件；
 * - 人物名只用于服务端与本家庭 Person displayName 的精确匹配。
 */

const MAX_KEYWORDS = 8;
const MAX_SYNONYMS = 8;
const MAX_TOKEN_CHARS = 40;
const MEDIA_TYPES = ["image", "video", "audio", "document"] as const;

export type NaturalLanguageQueryPlan = Readonly<{
  keywords: readonly string[];
  synonyms: readonly string[];
  personNames: readonly string[];
  year: number | null;
  month: number | null;
  mediaType: (typeof MEDIA_TYPES)[number] | null;
}>;

export type NaturalLanguageExpansion = Readonly<{
  ok: true;
  plan: NaturalLanguageQueryPlan;
  /** 透传给 FTS 的最终关键词集合（关键词 + 同义词）。 */
  terms: readonly string[];
  provenance: { providerId: string; providerName: string; model: string };
}>;

export type NaturalLanguageExpansionError =
  | { ok: false; error: "ai_unavailable" | "invalid_model_output" | "empty_query" };

const PROMPT = [
  "你是家庭记忆库的检索条件转换器。用户会给一句中文描述。",
  "只输出一个 JSON 对象，不要输出任何其他文字：",
  '{"keywords":["2-6个检索关键词"],"synonyms":["0-8个同义词或近义说法"],',
  '"personNames":["提到的家人名字或称谓,没有则空数组"],',
  '"year":null,"month":null,"mediaType":null}',
  "year/month 是提到的年份(如 2024)与月份(1-12)，没有为 null。",
  "mediaType 只能是 image/video/audio/document 之一，没有为 null。",
  "keywords 用用户原话中最具体的词；不要发明用户没提到的人名、地名或事件。",
].join("\n");

function cleanToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_TOKEN_CHARS);
  if (trimmed.length === 0) return null;
  // 控制字符与结构符号一律拒绝（提示注入/SQL/脚本不进入检索表达式）。
  if (/[\u0000-\u001f\u007f]/u.test(trimmed)) return null;
  if (/[`"'();{}[\]<>\\|&!*^$]/u.test(trimmed)) return null;
  return trimmed;
}

function cleanTokenList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned = value.map(cleanToken).filter((t): t is string => t !== null);
  return [...new Set(cleaned)].slice(0, max);
}

function parsePlan(value: unknown): NaturalLanguageQueryPlan | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const keywords = cleanTokenList(record.keywords, MAX_KEYWORDS);
  if (keywords.length === 0) return null;
  const media = record.mediaType;
  const mediaType =
    typeof media === "string" && (MEDIA_TYPES as readonly string[]).includes(media)
      ? (media as NaturalLanguageQueryPlan["mediaType"])
      : null;
  const year =
    typeof record.year === "number" && Number.isSafeInteger(record.year) &&
    record.year >= 1900 && record.year <= 2100
      ? record.year
      : null;
  const month =
    typeof record.month === "number" && Number.isSafeInteger(record.month) &&
    record.month >= 1 && record.month <= 12
      ? record.month
      : null;
  return {
    keywords,
    synonyms: cleanTokenList(record.synonyms, MAX_SYNONYMS),
    personNames: cleanTokenList(record.personNames, 6),
    year,
    month,
    mediaType,
  };
}

/** 把受限计划映射为受权限控制的既有 SearchParams；人物名只做服务端精确匹配。 */
export function planToSearchParams(
  context: FamilyContext,
  plan: NaturalLanguageQueryPlan,
): SearchParams {
  const terms = [...plan.keywords, ...plan.synonyms];
  const params: SearchParams = { q: terms.join(" ") };

  if (plan.personNames.length > 0) {
    const db = getDb();
    const people = db
      .select({ id: personTable.id, displayName: personTable.displayName })
      .from(personTable)
      .where(eq(personTable.familyId, context.familyId))
      .all();
    const matched = people.find((p) =>
      plan.personNames.some((name) => p.displayName === name),
    );
    if (matched) params.personId = matched.id;
  }

  if (plan.year !== null) {
    params.dateFrom = `${plan.year}-01-01`;
    params.dateTo = plan.year + (plan.month !== null ? "" : "-12-31");
    if (plan.month !== null) {
      params.dateFrom = `${plan.year}-${String(plan.month).padStart(2, "0")}-01`;
      const endMonth = plan.month === 12 ? 1 : plan.month + 1;
      const endYear = plan.month === 12 ? plan.year + 1 : plan.year;
      params.dateTo = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
    }
  }
  if (plan.mediaType !== null) params.mediaType = plan.mediaType;
  return params;
}

export async function expandNaturalLanguageQuery(
  assistant: MemoryAssistant,
  query: string,
): Promise<NaturalLanguageExpansion | NaturalLanguageExpansionError> {
  const trimmed = query.trim().slice(0, 300);
  if (trimmed.length === 0) return { ok: false, error: "empty_query" };
  if (!assistant.supports("text")) {
    return { ok: false, error: "ai_unavailable" };
  }
  let raw: string;
  try {
    const result = await assistant.generateText({
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: trimmed },
      ],
      responseFormat: "json",
      maxOutputTokens: 512,
    });
    raw = result.text;
  } catch (error) {
    if (error instanceof AiCapabilityUnavailableError) {
      return { ok: false, error: "ai_unavailable" };
    }
    return { ok: false, error: "invalid_model_output" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalid_model_output" };
  }
  const plan = parsePlan(parsed);
  if (plan === null) return { ok: false, error: "invalid_model_output" };
  return {
    ok: true,
    plan,
    terms: [...plan.keywords, ...plan.synonyms],
    provenance: {
      providerId: assistant.provider.id,
      providerName: assistant.provider.displayName,
      model: assistant.capabilities.text.model ?? "",
    },
  };
}
