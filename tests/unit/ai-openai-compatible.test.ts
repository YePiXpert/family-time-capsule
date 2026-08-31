import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiCapabilityUnavailableError,
  AiInputError,
  AiProviderError,
} from "../../lib/ai";
import {
  loadAiProviderConfig,
  OpenAiCompatibleMemoryAssistant,
  type AiEnvironment,
  type AiFetch,
} from "../../lib/ai/server";

const TEST_KEY = "offline-test-key-never-real";
const BASE_ENV: AiEnvironment = {
  AI_PROVIDER: "openai-compatible",
  AI_BASE_URL: "https://compatible.example.test/v1",
  AI_API_KEY: TEST_KEY,
  AI_MODEL: "text-test-model",
  AI_VISION_MODEL: "vision-test-model",
  AI_TRANSCRIPTION_MODEL: "speech-test-model",
  AI_EMBEDDING_MODEL: "embedding-test-model",
};

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(value), { ...init, headers });
}

function createAssistant(
  fetch: AiFetch,
  overrides: AiEnvironment = {},
): OpenAiCompatibleMemoryAssistant {
  const config = loadAiProviderConfig({ ...BASE_ENV, ...overrides });
  if (config.kind !== "openai-compatible") {
    throw new Error("Expected an enabled test configuration.");
  }
  return new OpenAiCompatibleMemoryAssistant(config, { fetch });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("OpenAI-compatible MemoryAssistant", () => {
  it("sends text to the configured model through an injected transport", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fetch: AiFetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse({
        model: "provider-resolved-text-model",
        choices: [
          { message: { content: "safe result" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      });
    };
    const assistant = createAssistant(fetch);

    const result = await assistant.generateText({
      messages: [{ role: "user", content: "offline fixture" }],
      maxOutputTokens: 100,
      temperature: 0,
      responseFormat: "json",
    });

    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe(
      "https://compatible.example.test/v1/chat/completions",
    );
    expect(calls[0]?.init).toMatchObject({
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TEST_KEY}`);
    const request = JSON.parse(String(calls[0]?.init?.body)) as Record<
      string,
      unknown
    >;
    expect(request).toEqual({
      model: "text-test-model",
      messages: [{ role: "user", content: "offline fixture" }],
      max_tokens: 100,
      temperature: 0,
      response_format: { type: "json_object" },
    });
    expect(String(calls[0]?.input)).not.toContain(TEST_KEY);
    expect(String(calls[0]?.init?.body)).not.toContain(TEST_KEY);
    expect(result).toEqual({
      text: "safe result",
      finishReason: "stop",
      provenance: {
        providerId: "openai-compatible",
        providerName: "OpenAI-compatible endpoint",
        model: "provider-resolved-text-model",
      },
      usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
    });
  });

  it("does not infer text support from a separately configured vision model", async () => {
    const fetch = vi.fn<AiFetch>(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ content: Array<Record<string, unknown>> }>;
      };
      expect(request.model).toBe("vision-only-model");
      expect(request.messages[0]?.content).toEqual([
        { type: "text", text: "Describe visible details." },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,AQID" },
        },
      ]);
      return jsonResponse({
        choices: [{ message: { content: "A test image." } }],
      });
    });
    const assistant = createAssistant(fetch, {
      AI_MODEL: undefined,
      AI_VISION_MODEL: "vision-only-model",
      AI_TRANSCRIPTION_MODEL: undefined,
      AI_EMBEDDING_MODEL: undefined,
    });

    expect(assistant.supports("text")).toBe(false);
    expect(assistant.supports("vision")).toBe(true);
    await expect(
      assistant.generateText({
        messages: [{ role: "user", content: "must not fall back" }],
      }),
    ).rejects.toBeInstanceOf(AiCapabilityUnavailableError);
    expect(fetch).not.toHaveBeenCalled();

    const result = await assistant.analyzeImage({
      prompt: "Describe visible details.",
      image: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
    });
    expect(result.text).toBe("A test image.");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("uses a neutral multipart file name and validates transcript metadata", async () => {
    let sentForm: FormData | null = null;
    const fetch: AiFetch = async (_input, init) => {
      sentForm = init?.body as FormData;
      return jsonResponse({
        text: "A deterministic transcript.",
        language: "zh",
        duration: 2.5,
        segments: [{ start: 0, end: 2.5, text: "A deterministic transcript." }],
      });
    };
    const assistant = createAssistant(fetch);
    const result = await assistant.transcribeAudio({
      audio: {
        bytes: new Uint8Array([1, 2, 3, 4]),
        fileName: "private-family-recording-name.mp3",
        mimeType: "audio/mpeg",
      },
      language: "zh",
      prompt: "Names supplied with consent.",
    });

    expect(sentForm).not.toBeNull();
    const form = sentForm as unknown as FormData;
    expect(form.get("model")).toBe("speech-test-model");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.get("language")).toBe("zh");
    const file = form.get("file") as Blob & { name?: string };
    expect(file).toBeInstanceOf(Blob);
    expect(file.name).toBe("audio.mp3");
    expect(file.name).not.toContain("private-family");
    expect(result.segments).toEqual([
      {
        startSeconds: 0,
        endSeconds: 2.5,
        text: "A deterministic transcript.",
      },
    ]);
  });

  it("reorders embedding vectors by validated provider indexes", async () => {
    const assistant = createAssistant(async () =>
      jsonResponse({
        model: "embedding-result-model",
        data: [
          { index: 1, embedding: [0.3, 0.4] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
        usage: { prompt_tokens: 2, total_tokens: 2 },
      }),
    );

    const result = await assistant.createEmbeddings({
      inputs: ["first", "second"],
    });
    expect(result.vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(result.dimensions).toBe(2);
    expect(result.provenance.model).toBe("embedding-result-model");
  });

  it("drops transport errors and provider bodies that contain a key", async () => {
    const thrownSecret = "transport-echoed-secret";
    const bodySecret = "provider-body-secret";
    const transports: AiFetch[] = [
      async () => {
        throw new Error(thrownSecret);
      },
      async () =>
        new Response(JSON.stringify({ error: bodySecret }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    ];

    for (const fetch of transports) {
      const assistant = createAssistant(fetch);
      let thrown: unknown;
      try {
        await assistant.generateText({
          messages: [{ role: "user", content: "offline fixture" }],
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AiProviderError);
      const rendered = `${String(thrown)} ${JSON.stringify(thrown)} ${inspect(thrown)}`;
      expect(rendered).not.toContain(TEST_KEY);
      expect(rendered).not.toContain(thrownSecret);
      expect(rendered).not.toContain(bodySecret);
    }
  });

  it("one-way fingerprints a provider request id that reflects the API key", async () => {
    const assistant = createAssistant(
      async () =>
        new Response(JSON.stringify({ error: "denied" }), {
          status: 401,
          headers: {
            "content-type": "application/json",
            "x-request-id": TEST_KEY,
          },
        }),
    );

    let thrown: unknown;
    try {
      await assistant.generateText({
        messages: [{ role: "user", content: "offline fixture" }],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AiProviderError);
    expect(thrown).toMatchObject({
      requestId: expect.stringMatching(/^sha256:[0-9a-f]{24}$/u),
    });
    const rendered = `${String(thrown)} ${JSON.stringify(thrown)} ${inspect(thrown)}`;
    expect(rendered).not.toContain(TEST_KEY);
  });

  it("enforces a timeout even when an injected transport ignores abort", async () => {
    vi.useFakeTimers();
    const assistant = createAssistant(
      async () => new Promise<Response>(() => undefined),
      { AI_REQUEST_TIMEOUT_MS: "50" },
    );
    const operation = assistant.generateText({
      messages: [{ role: "user", content: "offline fixture" }],
    });
    const settled = operation.then(
      () => null,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(51);
    await expect(settled).resolves.toMatchObject({
      code: "ai_timeout",
      retryable: true,
    });
  });

  it("honors caller cancellation before starting the transport", async () => {
    const fetch = vi.fn<AiFetch>();
    const assistant = createAssistant(fetch);
    const controller = new AbortController();
    controller.abort();

    await expect(
      assistant.generateText({
        messages: [{ role: "user", content: "offline fixture" }],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "ai_aborted", retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an oversized request before invoking the transport", async () => {
    const fetch = vi.fn<AiFetch>();
    const assistant = createAssistant(fetch, { AI_MAX_REQUEST_BYTES: "4096" });

    await expect(
      assistant.generateText({
        messages: [{ role: "user", content: "x".repeat(5000) }],
      }),
    ).rejects.toBeInstanceOf(AiInputError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a response declared larger than the configured limit", async () => {
    const assistant = createAssistant(
      async () =>
        jsonResponse(
          { choices: [{ message: { content: "ignored" } }] },
          { headers: { "content-length": "2048" } },
        ),
      { AI_MAX_RESPONSE_BYTES: "1024" },
    );

    await expect(
      assistant.generateText({
        messages: [{ role: "user", content: "offline fixture" }],
      }),
    ).rejects.toMatchObject({ code: "ai_response_too_large" });
  });

  it("stops reading a streamed response when it crosses the byte limit", async () => {
    const assistant = createAssistant(
      async () =>
        new Response(`"${"x".repeat(1100)}"`, {
          headers: { "content-type": "application/json" },
        }),
      { AI_MAX_RESPONSE_BYTES: "1024" },
    );

    await expect(
      assistant.generateText({
        messages: [{ role: "user", content: "offline fixture" }],
      }),
    ).rejects.toMatchObject({ code: "ai_response_too_large" });
  });

  it.each([
    [
      "a non-JSON content type",
      () => new Response("not json", { headers: { "content-type": "text/plain" } }),
    ],
    [
      "malformed JSON",
      () =>
        new Response("{", { headers: { "content-type": "application/json" } }),
    ],
    ["missing choices", () => jsonResponse({ choices: [] })],
    [
      "non-finite embeddings",
      () =>
        jsonResponse({
          data: [{ index: 0, embedding: [1, "not-a-number"] }],
        }),
    ],
  ])("rejects %s without accepting an untrusted response", async (label, response) => {
    const assistant = createAssistant(async () => response());
    const operation =
      label === "non-finite embeddings"
        ? assistant.createEmbeddings({ inputs: ["fixture"] })
        : assistant.generateText({
            messages: [{ role: "user", content: "fixture" }],
          });
    await expect(operation).rejects.toMatchObject({
      code: "ai_response_invalid",
    });
  });
});
