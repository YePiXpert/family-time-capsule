import { AI_CAPABILITIES, type AiCapability, type AiCapabilityMap } from "./types";
import {
  createCapabilityMap,
  NO_AI_MODELS,
  type AiModels,
} from "./capabilities";
import { AiConfigurationError } from "./errors";
import { assertAiServerRuntime } from "./server-runtime";

const REDACTED = "[REDACTED]";
const PROVIDER_VARIABLES = [
  "AI_BASE_URL",
  "AI_API_KEY",
  "AI_MODEL",
  "AI_VISION_MODEL",
  "AI_TRANSCRIPTION_MODEL",
  "AI_EMBEDDING_MODEL",
  "AI_PROVIDER_LABEL",
  "AI_REQUEST_TIMEOUT_MS",
  "AI_MAX_REQUEST_BYTES",
  "AI_MAX_RESPONSE_BYTES",
] as const;

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
  apiKey: AiSecret;
  providerLabel: string;
  models: AiModels;
  capabilities: AiCapabilityMap;
  requestTimeoutMs: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
}>;

export type AiProviderConfig =
  | DisabledAiProviderConfig
  | OpenAiCompatibleConfig;

export type AiConfigurationSummary = Readonly<{
  enabled: boolean;
  providerId: "disabled" | "openai-compatible";
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

  url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.href.replace(/\/$/u, "");
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

function assertNoOrphanedProviderVariables(env: AiEnvironment): void {
  const orphan = PROVIDER_VARIABLES.find(
    (variable) => env[variable] !== undefined && env[variable] !== "",
  );
  if (orphan !== undefined) {
    throw new AiConfigurationError(
      `${orphan} is set while AI_PROVIDER is disabled or unset.`,
      orphan,
    );
  }
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
    assertNoOrphanedProviderVariables(env);
    return Object.freeze({
      kind: "disabled",
      capabilities: createCapabilityMap(NO_AI_MODELS, "disabled"),
    });
  }

  if (provider !== "openai-compatible") {
    throw new AiConfigurationError(
      "AI_PROVIDER must be 'disabled', 'none', or 'openai-compatible'.",
      "AI_PROVIDER",
    );
  }

  const baseUrl = normalizeBaseUrl(requireNonEmpty(env, "AI_BASE_URL"));
  const apiKeyValue = requireNonEmpty(env, "AI_API_KEY");
  if (apiKeyValue.length > 4096) {
    throw new AiConfigurationError("AI_API_KEY is too long.", "AI_API_KEY");
  }

  const models: AiModels = Object.freeze({
    text: optionalModel(env, "AI_MODEL"),
    vision: optionalModel(env, "AI_VISION_MODEL"),
    transcription: optionalModel(env, "AI_TRANSCRIPTION_MODEL"),
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
    maxResponseBytes: parseInteger(
      env,
      "AI_MAX_RESPONSE_BYTES",
      DEFAULT_AI_MAX_RESPONSE_BYTES,
      1024,
      16 * 1024 * 1024,
    ),
  });
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
