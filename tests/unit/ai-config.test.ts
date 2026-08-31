import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { AiConfigurationError } from "../../lib/ai";
import {
  loadAiProviderConfig,
  summarizeAiConfiguration,
  type AiEnvironment,
} from "../../lib/ai/server";

const BASE_ENV: AiEnvironment = {
  AI_PROVIDER: "openai-compatible",
  AI_BASE_URL: "https://ai.example.test/v1/",
  AI_API_KEY: "test-only-secret",
  AI_MODEL: "text-model",
};

describe("AI provider configuration", () => {
  it("defaults to a fully disabled provider without requiring a key", () => {
    const config = loadAiProviderConfig({});
    const summary = summarizeAiConfiguration(config);

    expect(config.kind).toBe("disabled");
    expect(summary.enabled).toBe(false);
    expect(summary.capabilities).toEqual({
      text: { available: false, model: null, reason: "disabled" },
      vision: { available: false, model: null, reason: "disabled" },
      transcription: { available: false, model: null, reason: "disabled" },
      embeddings: { available: false, model: null, reason: "disabled" },
    });
  });

  it("treats Compose-style empty optional values as unset", () => {
    expect(
      loadAiProviderConfig({
        AI_PROVIDER: "disabled",
        AI_BASE_URL: "",
        AI_API_KEY: "",
        AI_PROVIDER_LABEL: "",
        AI_MODEL: "",
      }).kind,
    ).toBe("disabled");
    const configured = loadAiProviderConfig({
      ...BASE_ENV,
      AI_PROVIDER_LABEL: "",
    });
    expect(configured.kind).toBe("openai-compatible");
    if (configured.kind === "openai-compatible") {
      expect(configured.providerLabel).toBe("OpenAI-compatible endpoint");
    }
  });

  it("refuses orphaned settings instead of silently enabling or ignoring AI", () => {
    expect(() =>
      loadAiProviderConfig({ AI_API_KEY: "must-not-be-used" }),
    ).toThrow(AiConfigurationError);
  });

  it("detects each model capability independently with no fallback", () => {
    const config = loadAiProviderConfig({
      AI_PROVIDER: "openai-compatible",
      AI_BASE_URL: "https://vision.example.test/v1",
      AI_API_KEY: "test-key",
      AI_VISION_MODEL: "vision-only",
    });

    expect(config.kind).toBe("openai-compatible");
    if (config.kind !== "openai-compatible") return;
    expect(config.baseUrl).toBe("https://vision.example.test/v1");
    expect(config.capabilities).toEqual({
      text: { available: false, model: null, reason: "not_configured" },
      vision: { available: true, model: "vision-only", reason: "configured" },
      transcription: {
        available: false,
        model: null,
        reason: "not_configured",
      },
      embeddings: {
        available: false,
        model: null,
        reason: "not_configured",
      },
    });
  });

  it("redacts an API key in string, JSON, and inspection representations", () => {
    const secret = "not-a-real-key-do-not-print";
    const config = loadAiProviderConfig({ ...BASE_ENV, AI_API_KEY: secret });
    expect(config.kind).toBe("openai-compatible");
    if (config.kind !== "openai-compatible") return;

    expect(String(config.apiKey)).toBe("[REDACTED]");
    expect(JSON.stringify(config)).not.toContain(secret);
    expect(inspect(config, { showHidden: true })).not.toContain(secret);
    expect(config.apiKey.revealForProvider()).toBe(secret);
  });

  it.each([
    ["an unknown provider", { ...BASE_ENV, AI_PROVIDER: "openai" }],
    ["a missing base URL", { ...BASE_ENV, AI_BASE_URL: undefined }],
    ["a missing key", { ...BASE_ENV, AI_API_KEY: undefined }],
    [
      "no capability models",
      { ...BASE_ENV, AI_MODEL: undefined, AI_VISION_MODEL: undefined },
    ],
    [
      "a public API key variable",
      { ...BASE_ENV, NEXT_PUBLIC_AI_API_KEY: "public-secret" },
    ],
    [
      "credentials in the base URL",
      {
        ...BASE_ENV,
        AI_BASE_URL: "https://hidden:credential@ai.example.test/v1",
      },
    ],
    [
      "a base URL query",
      { ...BASE_ENV, AI_BASE_URL: "https://ai.example.test/v1?token=hidden" },
    ],
    [
      "cleartext HTTP to a remote host",
      { ...BASE_ENV, AI_BASE_URL: "http://ai.example.test/v1" },
    ],
    [
      "an invalid timeout",
      { ...BASE_ENV, AI_REQUEST_TIMEOUT_MS: "49" },
    ],
    [
      "an invalid response limit",
      { ...BASE_ENV, AI_MAX_RESPONSE_BYTES: "unlimited" },
    ],
  ])("rejects %s", (_label, env) => {
    expect(() => loadAiProviderConfig(env)).toThrow(AiConfigurationError);
  });

  it("allows cleartext HTTP only for an explicitly local compatible endpoint", () => {
    const config = loadAiProviderConfig({
      ...BASE_ENV,
      AI_BASE_URL: "http://127.0.0.1:11434/v1",
    });
    expect(config.kind).toBe("openai-compatible");
  });

  it("never includes rejected secret values in configuration errors", () => {
    const key = "rejected-key-value";
    const credential = "url-password-value";
    let thrown: unknown;
    try {
      loadAiProviderConfig({
        ...BASE_ENV,
        AI_API_KEY: key,
        AI_BASE_URL: `https://user:${credential}@ai.example.test/v1`,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AiConfigurationError);
    const rendered = `${String(thrown)} ${JSON.stringify(thrown)} ${inspect(thrown)}`;
    expect(rendered).not.toContain(key);
    expect(rendered).not.toContain(credential);
  });
});
