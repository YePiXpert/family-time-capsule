import "server-only";
import { createHash } from "node:crypto";

import { AI_CAPABILITIES, type AiCapability, type AiCapabilityMap } from "./types";
import {
  createCapabilityMap,
  NO_AI_MODELS,
  type AiModels,
} from "./capabilities";
import { AiConfigurationError } from "./errors";
import { assertAiServerRuntime } from "./server-runtime";

const REDACTED = "[REDACTED]";
const CLIENT_SECRET_VARIABLES = [
  "NEXT_PUBLIC_AI_API_KEY",
  "NEXT_PUBLIC_OPENAI_API_KEY",
] as const;

export const DEFAULT_AI_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_AI_MAX_REQUEST_BYTES = 32 * 1024 * 1024;
export const DEFAULT_AI_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * A secret whose normal string/JSON/console representations are redacted.
 * Only the provider transport calls `revealForProvider()`.
 */
export class AiSecret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
    Object.freeze(this);
  }

  revealForProvider(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.toPrimitive](): string {
    return REDACTED;
  }
}

export type DisabledAiProviderConfig = Readonly<{
  kind: "disabled";
  capabilities: AiCapabilityMap;
}>;

export type OpenAiCompatibleConfig = Readonly<{
  kind: "openai-compatible";
  baseUrl: string;
  configurationId: string;
  apiKey: AiSecret;
  providerLabel: string;
  models: AiModels;
  capabilities: AiCapabilityMap;
  requestTimeoutMs: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
  tokenParameter: "max_tokens" | "max_completion_tokens";
  temperatureSupported: boolean;
  jsonMode: "json_object" | "prompt_only";
  transcriptionFormat: "json" | "verbose_json" | "text";
  /**
   * AI-2：按能力选择 API 形态。responses=OpenAI Responses 端点
   * （/responses，input 消息数组 + max_output_tokens）；chat_completions=
   * 传统 /chat/completions。Luna 官方地址用 Responses，第三方兼容地址
   * 通常只有 Chat Completions——由管理员按端点能力配置。
   */
  textProfile: "responses" | "chat_completions";
  visionProfile: "responses" | "chat_completions";
}>;

/**
 * M6 语音路由：MiMo-V2.5-ASR（小米官方 OpenAI 兼容契约）。
 * - 端点是 chat/completions + input_audio（data URL Base64），不是
 *   /audio/transcriptions multipart；
 * - 认证头 api-key；响应文本在 choices[0].message.content；
 * - 仅接受 mp3 与 wav；响应不含逐段时间戳（转写层不得虚构 segments）。
 */
export type MimoAsrConfig = Readonly<{
  kind: "mimo-asr";
  baseUrl: string;
  configurationId: string;
  apiKey: AiSecret;
  providerLabel: string;
  model: string;
  language: "auto" | "zh" | "en";
  requestTimeoutMs: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
}>;

/** M6 双路由：文字/图片（含 embeddings）走 CPA，语音转写走 MiMo。 */
export type DualRouteConfig = Readonly<{
  kind: "dual-route";
  primary: OpenAiCompatibleConfig;
  asr: MimoAsrConfig;
  capabilities: AiCapabilityMap;
}>;

export type AiProviderConfig =
  | DisabledAiProviderConfig
  | OpenAiCompatibleConfig
  | DualRouteConfig;

export type AiConfigurationSummary = Readonly<{
  enabled: boolean;
  providerId: "disabled" | "openai-compatible" | "dual-route";
  providerName: string;
  capabilities: AiCapabilityMap;
}>;

export type AiEnvironment = Readonly<Record<string, string | undefined>>;

function requireNonEmpty(
  env: AiEnvironment,
  variable: string,
): string {
  const value = env[variable];
  if (value === undefined || value.length === 0) {
    throw new AiConfigurationError(`${variable} is required.`, variable);
  }
  if (value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new AiConfigurationError(
      `${variable} contains invalid whitespace or control characters.`,
      variable,
    );
  }
  return value;
}

function optionalModel(env: AiEnvironment, variable: string): string | null {
  const value = env[variable];
  if (value === undefined || value === "") return null;
  if (
    value.trim() !== value ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new AiConfigurationError(`${variable} is invalid.`, variable);
  }
  return value;
}

function parseInteger(
  env: AiEnvironment,
  variable: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[variable];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/u.test(raw)) {
    throw new AiConfigurationError(
      `${variable} must be a base-10 integer.`,
      variable,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new AiConfigurationError(
      `${variable} must be between ${minimum} and ${maximum}.`,
      variable,
    );
  }
  return value;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AiConfigurationError(
      "AI_BASE_URL must be an absolute HTTP(S) URL.",
      "AI_BASE_URL",
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AiConfigurationError(
      "AI_BASE_URL must use HTTP or HTTPS.",
      "AI_BASE_URL",
    );
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new AiConfigurationError(
      "AI_BASE_URL must not contain credentials, a query, or a fragment.",
      "AI_BASE_URL",
    );
  }
  if (url.hostname.length === 0) {
    throw new AiConfigurationError(
      "AI_BASE_URL must contain a host.",
      "AI_BASE_URL",
    );
  }
  const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  const loopback =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname);
  if (url.protocol === "http:" && !loopback) {
    throw new AiConfigurationError(
      "AI_BASE_URL must use HTTPS unless it targets a loopback host.",
      "AI_BASE_URL",
    );
  }

  url.pathname = url.pathname.replace(/\/+$/u, "").replace(/(?:\/v1){2,}$/u, "/v1");
  if (!url.pathname || url.pathname === "/") url.pathname = "/v1";
  return url.href.replace(/\/$/u, "");
}

/** M6：MiMo 官方 ASR 端点（chat/completions 契约）的默认地址。 */
export const DEFAULT_ASR_BASE_URL = "https://api.xiaomimimo.com/v1";
/** M6：Goal 固定的两条默认模型路由。 */
export const DEFAULT_PRIMARY_MODEL = "gpt-5.6-luna";
export const DEFAULT_ASR_MODEL = "mimo-v2.5-asr";

function normalizeAsrBaseUrl(value: string): string {
  // 与主路由同一套安全规则，但变量名指向 ASR_*。
  try {
    const checked = normalizeBaseUrl(value);
    return checked;
  } catch (error) {
    if (error instanceof AiConfigurationError) {
      throw new AiConfigurationError(
        error.message.replace("AI_BASE_URL", "ASR_BASE_URL"),
        "ASR_BASE_URL",
      );
    }
    throw error;
  }
}

function loadAsrChannel(env: AiEnvironment): MimoAsrConfig {
  const baseUrl = normalizeAsrBaseUrl(
    env.ASR_BASE_URL && env.ASR_BASE_URL !== ""
      ? env.ASR_BASE_URL
      : DEFAULT_ASR_BASE_URL,
  );
  const apiKeyRaw = requireNonEmpty(env, "ASR_API_KEY");
  if (apiKeyRaw.length > 4096) {
    throw new AiConfigurationError("ASR_API_KEY is too long.", "ASR_API_KEY");
  }
  const model = optionalModel(env, "ASR_MODEL") ?? DEFAULT_ASR_MODEL;
  const providerLabel =
    env.ASR_PROVIDER_LABEL && env.ASR_PROVIDER_LABEL !== ""
      ? env.ASR_PROVIDER_LABEL
      : "MiMo 语音识别";
  if (
    providerLabel.trim() !== providerLabel ||
    providerLabel.length === 0 ||
    providerLabel.length > 100 ||
    /[\u0000-\u001f\u007f]/u.test(providerLabel)
  ) {
    throw new AiConfigurationError(
      "ASR_PROVIDER_LABEL is invalid.",
      "ASR_PROVIDER_LABEL",
    );
  }
  const language = option(env, "ASR_LANGUAGE", ["auto", "zh", "en"], "auto");
  return Object.freeze({
    kind: "mimo-asr",
    baseUrl,
    configurationId: createHash("sha256")
      .update(
        JSON.stringify({
          baseUrl,
          model,
          providerLabel,
          language,
          revision: optionalModel(env, "ASR_CONFIGURATION_ID"),
        }),
      )
      .digest("hex"),
    apiKey: new AiSecret(apiKeyRaw),
    providerLabel,
    model,
    language,
    requestTimeoutMs: parseInteger(
      env,
      "ASR_REQUEST_TIMEOUT_MS",
      DEFAULT_AI_REQUEST_TIMEOUT_MS,
      50,
      600_000,
    ),
    maxRequestBytes: parseInteger(
      env,
      "ASR_MAX_REQUEST_BYTES",
      48 * 1024 * 1024,
      4096,
      160 * 1024 * 1024,
    ),
    maxResponseBytes: parseInteger(
      env,
      "ASR_MAX_RESPONSE_BYTES",
      DEFAULT_AI_MAX_RESPONSE_BYTES,
      1024,
      16 * 1024 * 1024,
    ),
  });
}

function assertNoClientSecretVariables(env: AiEnvironment): void {
  for (const variable of CLIENT_SECRET_VARIABLES) {
    if (env[variable] !== undefined) {
      throw new AiConfigurationError(
        `${variable} is forbidden because NEXT_PUBLIC_ values reach clients.`,
        variable,
      );
    }
  }
}

function option<T extends string>(env: AiEnvironment, key: string, choices: readonly T[], fallback: T): T {
  const value = env[key];
  if (!value) return fallback;
  if (!choices.includes(value as T)) throw new AiConfigurationError(`${key} is invalid.`, key);
  return value as T;
}

function loadPrimaryChannel(
  env: AiEnvironment,
  defaultModels: boolean,
): OpenAiCompatibleConfig {
  const baseUrl = normalizeBaseUrl(requireNonEmpty(env, "AI_BASE_URL"));
  const apiKeyValue = requireNonEmpty(env, "AI_API_KEY");
  if (apiKeyValue.length > 4096) {
    throw new AiConfigurationError("AI_API_KEY is too long.", "AI_API_KEY");
  }

  const models: AiModels = Object.freeze({
    text: optionalModel(env, "AI_MODEL") ?? (defaultModels ? DEFAULT_PRIMARY_MODEL : null),
    vision:
      optionalModel(env, "AI_VISION_MODEL") ??
      (defaultModels ? optionalModel(env, "AI_MODEL") ?? DEFAULT_PRIMARY_MODEL : null),
    transcription: defaultModels
      ? null // 双路由下语音固定走 MiMo，主通道不承接转写。
      : optionalModel(env, "AI_TRANSCRIPTION_MODEL"),
    embeddings: optionalModel(env, "AI_EMBEDDING_MODEL"),
  });
  if (AI_CAPABILITIES.every((capability) => models[capability] === null)) {
    throw new AiConfigurationError(
      "At least one AI capability model must be configured.",
      null,
    );
  }

  const providerLabel =
    env.AI_PROVIDER_LABEL || "OpenAI-compatible endpoint";
  if (
    providerLabel.trim() !== providerLabel ||
    providerLabel.length === 0 ||
    providerLabel.length > 100 ||
    /[\u0000-\u001f\u007f]/u.test(providerLabel)
  ) {
    throw new AiConfigurationError(
      "AI_PROVIDER_LABEL is invalid.",
      "AI_PROVIDER_LABEL",
    );
  }

  return Object.freeze({
    kind: "openai-compatible",
    baseUrl,
    configurationId: createHash("sha256").update(JSON.stringify({ baseUrl, models, providerLabel,
      revision: optionalModel(env, "AI_CONFIGURATION_ID"),
      tokenParameter: env.AI_TOKEN_PARAMETER ?? "max_completion_tokens",
      jsonMode: env.AI_JSON_MODE ?? "json_object", transcriptionFormat: env.AI_TRANSCRIPTION_FORMAT ?? "json",
      temperatureSupported: env.AI_TEMPERATURE_SUPPORTED ?? "true",
      textProfile: env.AI_TEXT_PROFILE ?? "chat_completions",
      visionProfile: env.AI_VISION_PROFILE ?? "chat_completions",
    })).digest("hex"),
    apiKey: new AiSecret(apiKeyValue),
    providerLabel,
    models,
    capabilities: createCapabilityMap(models, "not_configured"),
    requestTimeoutMs: parseInteger(
      env,
      "AI_REQUEST_TIMEOUT_MS",
      DEFAULT_AI_REQUEST_TIMEOUT_MS,
      50,
      120_000,
    ),
    maxRequestBytes: parseInteger(
      env,
      "AI_MAX_REQUEST_BYTES",
      DEFAULT_AI_MAX_REQUEST_BYTES,
      4096,
      100 * 1024 * 1024,
    ),
    tokenParameter: option(env, "AI_TOKEN_PARAMETER", ["max_tokens", "max_completion_tokens"], "max_completion_tokens"),
    temperatureSupported: option(env, "AI_TEMPERATURE_SUPPORTED", ["true", "false"], "true") === "true",
    jsonMode: option(env, "AI_JSON_MODE", ["json_object", "prompt_only"], "json_object"),
    transcriptionFormat: option(env, "AI_TRANSCRIPTION_FORMAT", ["json", "verbose_json", "text"], "json"),
    textProfile: option(env, "AI_TEXT_PROFILE", ["responses", "chat_completions"], "chat_completions"),
    visionProfile: option(env, "AI_VISION_PROFILE", ["responses", "chat_completions"], "chat_completions"),
    maxResponseBytes: parseInteger(
      env,
      "AI_MAX_RESPONSE_BYTES",
      DEFAULT_AI_MAX_RESPONSE_BYTES,
      1024,
      16 * 1024 * 1024,
    ),
  });
}

/** 为能力状态标注实际接收方（双路由同意/任务绑定用）。 */
function withReceiver(
  status: AiCapabilityMap[AiCapability],
  receiver: { id: string; label: string; configurationId: string },
): AiCapabilityMap[AiCapability] {
  if (!status.available) return status;
  return Object.freeze({
    ...status,
    providerId: receiver.id,
    providerName: receiver.label,
    configurationId: receiver.configurationId,
  });
}

function loadDualRouteConfig(env: AiEnvironment): DualRouteConfig {
  const primary = loadPrimaryChannel(env, true);
  const asr = loadAsrChannel(env);
  const primaryCapabilities = createCapabilityMap(primary.models, "not_configured");
  const capabilities = Object.freeze({
    text: withReceiver(primaryCapabilities.text, {
      id: "openai-compatible",
      label: primary.providerLabel,
      configurationId: primary.configurationId,
    }),
    vision: withReceiver(primaryCapabilities.vision, {
      id: "openai-compatible",
      label: primary.providerLabel,
      configurationId: primary.configurationId,
    }),
    embeddings: withReceiver(primaryCapabilities.embeddings, {
      id: "openai-compatible",
      label: primary.providerLabel,
      configurationId: primary.configurationId,
    }),
    transcription: Object.freeze({
      available: true,
      model: asr.model,
      reason: "configured" as const,
      providerId: "mimo-asr",
      providerName: asr.providerLabel,
      configurationId: asr.configurationId,
    }),
  }) as AiCapabilityMap;
  return Object.freeze({ kind: "dual-route", primary, asr, capabilities });
}

export function loadAiProviderConfig(
  env: AiEnvironment = process.env,
): AiProviderConfig {
  assertAiServerRuntime();
  assertNoClientSecretVariables(env);

  const provider = env.AI_PROVIDER;
  if (
    provider === undefined ||
    provider === "" ||
    provider === "disabled" ||
    provider === "none"
  ) {
    // Disabling wins over stale or malformed provider settings. Core use stays available.
    return Object.freeze({
      kind: "disabled",
      capabilities: createCapabilityMap(NO_AI_MODELS, "disabled"),
    });
  }

  if (provider === "dual") {
    // M6 双路由：文字/图片/embeddings 走 CPA（默认 gpt-5.6-luna），
    // 语音转写走 MiMo（默认 mimo-v2.5-asr）。
    return loadDualRouteConfig(env);
  }

  if (provider !== "openai-compatible") {
    throw new AiConfigurationError(
      "AI_PROVIDER must be 'disabled', 'none', 'openai-compatible', or 'dual'.",
      "AI_PROVIDER",
    );
  }

  return loadPrimaryChannel(env, false);
}

export function summarizeAiConfiguration(
  config: AiProviderConfig,
): AiConfigurationSummary {
  if (config.kind === "disabled") {
    return Object.freeze({
      enabled: false,
      providerId: "disabled",
      providerName: "Disabled",
      capabilities: config.capabilities,
    });
  }
  if (config.kind === "dual-route") {
    return Object.freeze({
      enabled: true,
      providerId: "dual-route",
      providerName: `${config.primary.providerLabel} + ${config.asr.providerLabel}`,
      capabilities: config.capabilities,
    });
  }
  return Object.freeze({
    enabled: true,
    providerId: "openai-compatible",
    providerName: config.providerLabel,
    capabilities: config.capabilities,
  });
}

export function configuredModel(
  config: OpenAiCompatibleConfig,
  capability: AiCapability,
): string | null {
  return config.models[capability];
}
