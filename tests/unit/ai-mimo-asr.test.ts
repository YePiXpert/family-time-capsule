import { describe, expect, it } from "vitest";
import { loadAiProviderConfig, MimoAsrTranscriber, type AiEnvironment, type AiFetch } from "@/lib/ai/server";
import { AiInputError, AiProviderError } from "@/lib/ai/errors";

/**
 * M6 MiMo-V2.5-ASR 适配器测试：
 * - 契约形状：POST {base}/chat/completions、api-key 头、input_audio data URL、
 *   asr_options.language（非 auto 时）、stream=false；
 * - 响应解析：choices[0].message.content 文本、usage.seconds 时长、无 segments；
 * - 输入防线：仅 mp3/wav，其余格式明确拒绝（不静默转码）。
 */

const BASE_ENV: AiEnvironment = {
  AI_PROVIDER: "dual",
  AI_BASE_URL: "https://cpa.example.test/v1",
  AI_API_KEY: "primary-test-key",
  AI_MODEL: "gpt-5.6-luna",
  ASR_API_KEY: "mimo-test-key",
};

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(value), { ...init, headers });
}

function createTranscriber(
  fetch: AiFetch,
  overrides: AiEnvironment = {},
): MimoAsrTranscriber {
  const config = loadAiProviderConfig({ ...BASE_ENV, ...overrides });
  if (config.kind !== "dual-route") {
    throw new Error("Expected a dual-route test configuration.");
  }
  return new MimoAsrTranscriber(config.asr, { fetch });
}

function chatCompletion(text: string, seconds?: number): Response {
  return jsonResponse({
    id: "chatcmpl-mimo",
    object: "chat.completion",
    created: 1788700000,
    model: "mimo-v2.5-asr",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: text },
      },
    ],
    usage: {
      prompt_tokens: 128,
      completion_tokens: 64,
      total_tokens: 192,
      seconds: seconds ?? 6.5,
    },
  });
}

const WAV_BYTES = new Uint8Array([82, 73, 70, 70, 24, 0, 0, 0]);

describe("MimoAsrTranscriber (M6)", () => {
  it("sends the MiMo chat/completions contract with api-key auth and data URL audio", async () => {
    const captured: Array<{ url: string; headers: Headers; body: unknown }> = [];
    const fetch: AiFetch = async (input, init) => {
      captured.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      return chatCompletion("你好，家人。");
    };
    const transcriber = createTranscriber(fetch);
    const result = await transcriber.transcribeAudio({
      audio: { bytes: WAV_BYTES, fileName: "a.wav", mimeType: "audio/wav" },
    });

    expect(captured).toHaveLength(1);
    const request = captured[0];
    if (!request) return;
    expect(request.url).toBe("https://api.xiaomimimo.com/v1/chat/completions");
    expect(request.headers.get("api-key")).toBe("mimo-test-key");
    expect(request.headers.get("authorization")).toBeNull();
    expect(request.headers.get("content-type")).toContain("application/json");

    const body = request.body as {
      model: string;
      stream: boolean;
      messages: Array<{
        role: string;
        content: Array<{
          type: string;
          input_audio: { data: string; format: string };
        }>;
      }>;
    };
    expect(body.model).toBe("mimo-v2.5-asr");
    expect(body.stream).toBe(false);
    expect(body.messages).toHaveLength(1);
    const part = body.messages[0]!.content[0]!;
    expect(part.type).toBe("input_audio");
    expect(part.input_audio.format).toBe("wav");
    expect(part.input_audio.data).toMatch(/^data:audio\/wav;base64,/u);

    // 解析:全文文本 + usage.seconds 时长 + 无虚构 segments + auto 语种如实为 null。
    expect(result.text).toBe("你好，家人。");
    expect(result.durationSeconds).toBe(6.5);
    expect(result.segments).toEqual([]);
    expect(result.language).toBeNull();
    expect(result.provenance).toMatchObject({
      providerId: "mimo-asr",
      model: "mimo-v2.5-asr",
    });
  });

  it("passes asr_options.language only for non-auto configured languages", async () => {
    const bodies: unknown[] = [];
    const fetch: AiFetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return chatCompletion("nihao");
    };
    const transcriber = createTranscriber(fetch, { ASR_LANGUAGE: "zh" });
    const result = await transcriber.transcribeAudio({
      audio: { bytes: WAV_BYTES, fileName: "a.wav", mimeType: "audio/wav" },
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ asr_options: { language: "zh" } });
    expect(result.language).toBe("zh");
  });

  it("rejects non mp3/wav inputs loudly instead of transcoding silently", async () => {
    const transcriber = createTranscriber(async () => chatCompletion("x"));
    await expect(
      transcriber.transcribeAudio({
        audio: { bytes: WAV_BYTES, fileName: "a.m4a", mimeType: "audio/m4a" },
      }),
    ).rejects.toBeInstanceOf(AiInputError);
    await expect(
      transcriber.transcribeAudio({
        audio: { bytes: WAV_BYTES, fileName: "a.flac", mimeType: "audio/flac" },
      }),
    ).rejects.toThrowError(/mp3 与 wav/u);
  });

  it("maps malformed responses to non-retryable provider errors", async () => {
    const transcriber = createTranscriber(async () => jsonResponse({ ok: true }));
    await expect(
      transcriber.transcribeAudio({
        audio: { bytes: WAV_BYTES, fileName: "a.wav", mimeType: "audio/wav" },
      }),
    ).rejects.toMatchObject({
      code: "ai_response_invalid",
      retryable: false,
    });
  });

  it("maps HTTP failures with retryable statuses and keeps the key out of errors", async () => {
    const transcriber = createTranscriber(
      async () =>
        new Response(JSON.stringify({ error: "mimo-test-key" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    const caught = await transcriber
      .transcribeAudio({
        audio: { bytes: WAV_BYTES, fileName: "a.wav", mimeType: "audio/wav" },
      })
      .then(
        () => null,
        (cause: unknown) => cause,
      );
    expect(caught).toBeInstanceOf(AiProviderError);
    expect(caught instanceof AiProviderError && caught.retryable).toBe(true);
    expect(JSON.stringify(caught)).not.toContain("mimo-test-key");
  });

  it("accepts mp3 pass-through with the mp3 format marker", async () => {
    let captured: unknown = null;
    const fetch: AiFetch = async (_input, init) => {
      captured = JSON.parse(String(init?.body));
      return chatCompletion("mp3 text");
    };
    const transcriber = createTranscriber(fetch);
    await transcriber.transcribeAudio({
      audio: {
        bytes: new Uint8Array([1, 2, 3]),
        fileName: "a.mp3",
        mimeType: "audio/mpeg",
      },
    });
    const body = captured as {
      messages: Array<{
        content: Array<{ input_audio: { data: string; format: string } }>;
      }>;
    };
    expect(body.messages[0]!.content[0]!.input_audio.format).toBe("mp3");
    expect(body.messages[0]!.content[0]!.input_audio.data).toMatch(
      /^data:audio\/mpeg;base64,/u,
    );
  });
});
