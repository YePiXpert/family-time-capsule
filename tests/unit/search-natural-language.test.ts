import { describe, expect, it } from "vitest";
import { DeterministicFakeMemoryAssistant } from "@/lib/ai/fake";
import {
  expandNaturalLanguageQuery,
  planToSearchParams,
} from "@/lib/search/natural-language";
import type { MemoryAssistant, GenerateTextResult } from "@/lib/ai/types";
import type { FamilyContext } from "@/lib/family/context";

/**
 * M7 自然语言辅助检索测试：
 * - 模型输出只允许白名单字段；SQL/脚本/超长/结构符号一律拒绝；
 * - 人物名只经服务端精确匹配，不进检索表达式；
 * - 年月映射为日期范围，媒体类型枚举校验；
 * - 无文字能力/坏输出 → 明确失败，不静默放宽带条件。
 */

const CONTEXT: FamilyContext = {
  userId: "user-1",
  userName: "测试",
  familyId: "family-1",
  personId: null,
  role: "owner",
  accountEnabled: true,
  isGuardian: false,
  familyTimezone: "Asia/Shanghai",
  childLaterUnlockAge: 18,
};

function assistantReturning(text: string): MemoryAssistant {
  const base = new DeterministicFakeMemoryAssistant();
  return {
    provider: base.provider,
    capabilities: base.capabilities,
    supports: (capability) => base.supports(capability),
    generateText: async (): Promise<GenerateTextResult> => ({
      text,
      finishReason: "stop",
      provenance: {
        providerId: "fake",
        providerName: "fake",
        model: "fake-text",
      },
    }),
    analyzeImage: (input) => base.analyzeImage(input),
    transcribeAudio: (input) => base.transcribeAudio(input),
    createEmbeddings: (input) => base.createEmbeddings(input),
  } as MemoryAssistant;
}

describe("natural language search expansion (M7)", () => {
  it("parses a valid plan and maps it to bounded FTS params", async () => {
    const assistant = assistantReturning(
      JSON.stringify({
        keywords: ["公园", "放风筝"],
        synonyms: ["户外", "春天"],
        personNames: ["小满"],
        year: 2026,
        month: 4,
        mediaType: "image",
      }),
    );
    const expansion = await expandNaturalLanguageQuery(assistant, "找一张四月去公园放风筝的照片");
    expect(expansion.ok).toBe(true);
    if (!expansion.ok) return;
    expect(expansion.terms).toEqual(["公园", "放风筝", "户外", "春天"]);

    const params = planToSearchParams(CONTEXT, expansion.plan);
    expect(params.q).toBe("公园 放风筝 户外 春天");
    expect(params.dateFrom).toBe("2026-04-01");
    expect(params.dateTo).toBe("2026-05-01");
    expect(params.mediaType).toBe("image");
    // 人物名不在检索表达式里（只做服务端精确匹配，本上下文无该人物）。
    expect(params.q).not.toContain("小满");
    expect(params.personId).toBeUndefined();
  });

  it("rejects structural injection tokens in model output", async () => {
    for (const malicious of [
      '{"keywords":["a;DELETE FROM user"]}',
      '{"keywords":["${jndi:ldap://evil}"]}',
      '{"keywords":["`rm -rf /`"]}',
      '{"keywords":["x\" OR 1=1 --"]}',
      '{"keywords":[]}',
      "not json at all",
    ]) {
      const assistant = assistantReturning(malicious);
      const expansion = await expandNaturalLanguageQuery(assistant, "随便");
      expect(expansion, malicious).toEqual({ ok: false, error: "invalid_model_output" });
    }
  });

  it("treats plain SQL-looking words as inert quoted FTS phrases, never SQL", async () => {
    // 结构符号已被拒绝;纯文字(即使长得像 SQL)只会变成带引号的 FTS 短语
    // 并以绑定参数执行——模型生成的 SQL 永远不会被当作 SQL 执行。
    const assistant = assistantReturning('{"keywords":["DROP TABLE search_index"]}');
    const expansion = await expandNaturalLanguageQuery(assistant, "随便");
    expect(expansion.ok).toBe(true);
    if (!expansion.ok) return;
    const { ftsQueryExpression } = await import("@/lib/search/tokenizer");
    const expression = ftsQueryExpression(expansion.terms.join(" "));
    expect(expression).not.toMatch(/DROP|TABLE/u);
    expect(expression).toContain("\"");
  });

  it("fails closed without the text capability", async () => {
    const base = new DeterministicFakeMemoryAssistant({
      capabilities: { text: false },
    });
    const expansion = await expandNaturalLanguageQuery(base, "找去年生日的照片");
    expect(expansion).toEqual({ ok: false, error: "ai_unavailable" });
  });

  it("clamps oversized lists and unknown enum values", async () => {
    const assistant = assistantReturning(
      JSON.stringify({
        keywords: Array.from({ length: 20 }, (_, i) => `词${i}`),
        synonyms: ["同义"],
        personNames: [],
        year: 99999,
        month: 13,
        mediaType: "hologram",
      }),
    );
    const expansion = await expandNaturalLanguageQuery(assistant, "测试");
    expect(expansion.ok).toBe(true);
    if (!expansion.ok) return;
    expect(expansion.plan.keywords.length).toBeLessThanOrEqual(8);
    expect(expansion.plan.year).toBeNull();
    expect(expansion.plan.month).toBeNull();
    expect(expansion.plan.mediaType).toBeNull();
    const params = planToSearchParams(CONTEXT, expansion.plan);
    expect(params.dateFrom).toBeUndefined();
    expect(params.mediaType).toBeUndefined();
  });
});
