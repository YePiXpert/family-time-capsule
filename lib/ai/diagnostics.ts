import "server-only";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { loadAiProviderConfig, type AiEnvironment } from "./config";
import type { MemoryAssistant } from "./types";

export const AI_ENV_KEYS = ["AI_CONFIGURATION_ID", "AI_PROVIDER", "AI_BASE_URL", "AI_API_KEY", "AI_PROVIDER_LABEL", "AI_MODEL", "AI_VISION_MODEL", "AI_TRANSCRIPTION_MODEL", "AI_EMBEDDING_MODEL", "AI_REQUEST_TIMEOUT_MS", "AI_MAX_REQUEST_BYTES", "AI_MAX_RESPONSE_BYTES", "AI_TOKEN_PARAMETER", "AI_TEMPERATURE_SUPPORTED", "AI_JSON_MODE", "AI_TRANSCRIPTION_FORMAT"] as const;

/** No key or key digest. Used inside each running container. Never calls a model. */
export function aiConfigurationStatus(env: AiEnvironment = process.env) {
  const config = loadAiProviderConfig(env);
  if (config.kind === "disabled") return { enabled: false, configured: false, keyConfigured: Boolean(env.AI_API_KEY) };
  return {
    enabled: true, configured: true, keyConfigured: true,
    configurationId: config.configurationId,
    endpoint: config.baseUrl, provider: config.providerLabel, models: config.models,
    requestTimeoutMs: config.requestTimeoutMs, maxRequestBytes: config.maxRequestBytes,
    maxResponseBytes: config.maxResponseBytes, tokenParameter: config.tokenParameter,
    temperatureSupported: config.temperatureSupported, jsonMode: config.jsonMode,
    transcriptionFormat: config.transcriptionFormat,
  };
}

/** Identifies only non-secret deployment settings; credentials never enter it. */
export function aiConfigurationFingerprint(env: AiEnvironment = process.env): string {
  return createHash("sha256").update(JSON.stringify(aiConfigurationStatus(env))).digest("hex");
}

export type AiCapabilityCheck = { state: "untested" | "passed" | "failed"; testedAt: string | null; code: string | null };

/** Read-only, bounded records. Changing deployment settings invalidates old tests. */
export function readAiCapabilityChecks(env: AiEnvironment = process.env): Record<"text" | "vision" | "transcription", AiCapabilityCheck> {
  const checks: Record<"text" | "vision" | "transcription", AiCapabilityCheck> = {
    text: { state: "untested", testedAt: null, code: null },
    vision: { state: "untested", testedAt: null, code: null },
    transcription: { state: "untested", testedAt: null, code: null },
  };
  let configuration: string;
  try { configuration = aiConfigurationFingerprint(env); } catch { return checks; }
  for (const capability of ["text", "vision", "transcription"] as const) {
    try {
      const file = path.join(env.DATA_DIR ?? "/data", "ai-diagnostics", `${capability}.json`);
      if (statSync(file).size > 8192) continue;
      const raw = readFileSync(file, "utf8");
      if (raw.length > 8192) continue;
      const row: unknown = JSON.parse(raw);
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const record = row as Record<string, unknown>;
      if (record.configuration !== configuration || record.capability !== capability || typeof record.passed !== "boolean" || typeof record.testedAt !== "string" || Number.isNaN(Date.parse(record.testedAt))) continue;
      checks[capability] = { state: record.passed ? "passed" : "failed", testedAt: new Date(record.testedAt).toISOString(), code: typeof record.code === "string" && /^(ai_[a-z_]{1,40}|capability_test_failed)$/u.test(record.code) ? record.code : null };
    } catch { /* Missing or obsolete test record is untested, not success. */ }
  }
  return checks;
}

export async function testAiCapability(assistant: MemoryAssistant, capability: "text" | "vision" | "transcription", sampleAudio: Uint8Array) {
  if (!assistant.supports(capability)) throw new Error("capability_not_configured");
  if (capability === "text") {
    const result = await assistant.generateText({ messages: [{ role: "user", content: 'Calculate 19 + 23. Return only a JSON object with one integer field "answer".' }], maxOutputTokens: 512, responseFormat: "json" });
    const parsed: unknown = JSON.parse(result.text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || (parsed as { answer?: unknown }).answer !== 42 || Object.keys(parsed).length !== 1) throw new Error("text_semantic_test_failed");
    return { capability, passed: true, usage: result.usage ?? null };
  }
  if (capability === "vision") {
    // Synthetic geometric image. The expected answer is not present in the prompt.
    const bytes = await sharp(Buffer.from('<svg width="128" height="128"><rect width="128" height="128" fill="white"/><circle cx="64" cy="64" r="40" fill="red"/></svg>')).png().toBuffer();
    const result = await assistant.analyzeImage({ image: { bytes, mimeType: "image/png" }, prompt: 'Identify the central shape and its color. Return only JSON with English lowercase fields "shape" and "color".', maxOutputTokens: 512 });
    const parsed: unknown = JSON.parse(result.text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || (parsed as { shape?: unknown }).shape !== "circle" || (parsed as { color?: unknown }).color !== "red") throw new Error("vision_semantic_test_failed");
    return { capability, passed: true, usage: result.usage ?? null };
  }
  const result = await assistant.transcribeAudio({ audio: { bytes: sampleAudio, mimeType: "audio/wav", fileName: "test.wav" }, language: "en" });
  const normalized = result.text.toLowerCase().replace(/[^a-z]+/gu, " ").trim();
  if (!normalized.includes("hello family") || !normalized.includes("test recording")) throw new Error("transcription_semantic_test_failed");
  return { capability, passed: true, usage: null };
}
