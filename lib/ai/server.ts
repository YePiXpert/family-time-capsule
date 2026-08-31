import { loadAiProviderConfig, type AiEnvironment } from "./config";
import { NullMemoryAssistant } from "./null";
import {
  OpenAiCompatibleMemoryAssistant,
  type OpenAiCompatibleDependencies,
} from "./openai-compatible";
import type { MemoryAssistant } from "./types";

export {
  AiSecret,
  configuredModel,
  loadAiProviderConfig,
  summarizeAiConfiguration,
  type AiConfigurationSummary,
  type AiEnvironment,
  type AiProviderConfig,
  type DisabledAiProviderConfig,
  type OpenAiCompatibleConfig,
} from "./config";
export {
  OpenAiCompatibleMemoryAssistant,
  type AiFetch,
  type OpenAiCompatibleDependencies,
} from "./openai-compatible";

/**
 * Runtime factory. Merely constructing an assistant performs no network I/O.
 * With no AI environment configuration it returns NullMemoryAssistant.
 */
export function createMemoryAssistant(
  env: AiEnvironment = process.env,
  dependencies: OpenAiCompatibleDependencies = {},
): MemoryAssistant {
  const config = loadAiProviderConfig(env);
  if (config.kind === "disabled") return new NullMemoryAssistant();
  return new OpenAiCompatibleMemoryAssistant(config, dependencies);
}
