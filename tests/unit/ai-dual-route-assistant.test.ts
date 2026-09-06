import { describe, expect, it } from "vitest";
import {
  DualRouteMemoryAssistant,
  loadAiProviderConfig,
  type AiEnvironment,
  type AiFetch,
} from "@/lib/ai/server";

/**
 * M6 双路由分发测试：文字/图片走主通道，语音走 MiMo；
 * 分能力接收方标注进入任务/同意绑定；聚合描述符合披露。
 */

const BASE_ENV: AiEnvironment = {
  AI_PROVIDER: "dual",
  AI_BASE_URL: "https://cpa.example.test/v1",
  AI_API_KEY: "primary-key",
  AI_MODEL: "gpt-5.6-luna",
  ASR_API_KEY: "mimo-key",
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

describe("DualRouteMemoryAssistant routing (M6)", () => {
  it("routes text to the primary channel and transcription to MiMo", async () => {
    const endpoints: string[] = [];
    const authHeaders: string[] = [];
    const fetch: AiFetch = async (input, init) => {
      endpoints.push(String(input));
      const headers = new Headers(init?.headers);
      authHeaders.push(headers.get("authorization") ?? `api-key:${headers.get("api-key")}`);
      const url = String(input);
      if (url.includes("chat/completions") && endpoints.filter((e) => e.includes("api.xiaomimimo")).length > 0 && url.includes("xiaomimimo")) {
        return jsonResponse({
          id: "x",
          object: "chat.completion",
          created: 1,
          model: "mimo-v2.5-asr",
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "语音转写文本" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, seconds: 3 },
        });
      }
      // 主通道 chat/completions（文字）
      return jsonResponse({
        id: "y",
        object: "chat.completion",
        created: 1,
        model: "gpt-5.6-luna",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"answer":42}' } }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      });
    };

    const config = loadAiProviderConfig(BASE_ENV);
    expect(config.kind).toBe("dual-route");
    if (config.kind !== "dual-route") return;
    const assistant = new DualRouteMemoryAssistant(config, { fetch });

    // 聚合描述符
    expect(assistant.provider.id).toBe("dual-route");
    expect(assistant.provider.external).toBe(true);
    expect(assistant.provider.displayName).toContain("MiMo");

    // 分能力接收方(任务/同意绑定用)
    expect(assistant.capabilities.text).toMatchObject({
      providerId: "openai-compatible",
      configurationId: config.primary.configurationId,
    });
    expect(assistant.capabilities.transcription).toMatchObject({
      providerId: "mimo-asr",
      configurationId: config.asr.configurationId,
    });

    // 文字 → 主通道 Bearer
    const text = await assistant.generateText({
      messages: [{ role: "user", content: 'Calculate 19 + 23. Return only a JSON object with one integer field "answer".' }],
    });
    expect(JSON.parse(text.text)).toEqual({ answer: 42 });

    // 语音 → MiMo api-key + chat/completions 契约
    const audio = await assistant.transcribeAudio({
      audio: { bytes: new Uint8Array([1, 2, 3, 4]), fileName: "a.wav", mimeType: "audio/wav" },
    });
    expect(audio.text).toBe("语音转写文本");
    expect(audio.segments).toEqual([]);

    expect(endpoints).toHaveLength(2);
    expect(endpoints[0]).toContain("cpa.example.test/v1/chat/completions");
    expect(endpoints[1]).toContain("api.xiaomimimo.com/v1/chat/completions");
    expect(authHeaders[0]).toContain("Bearer primary-key");
    expect(authHeaders[1]).toBe("api-key:mimo-key");
  });
});
