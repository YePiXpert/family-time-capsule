import "server-only";

import { loadAiProviderConfig, type AiEnvironment } from "./config";
import { NullMemoryAssistant } from "./null";
import {
  OpenAiCompatibleMemoryAssistant,
  type OpenAiCompatibleDependencies,
} from "./openai-compatible";
import { DualRouteMemoryAssistant } from "./dual-route";
import type { MemoryAssistant } from "./types";
import { createAiDispatcher, type AiExecutionContext } from "./dispatch";

export {
  AiSecret,
  configuredModel,
  loadAiProviderConfig,
  summarizeAiConfiguration,
  DEFAULT_ASR_BASE_URL,
  DEFAULT_PRIMARY_MODEL,
  DEFAULT_ASR_MODEL,
  type AiConfigurationSummary,
  type AiEnvironment,
  type AiProviderConfig,
  type DisabledAiProviderConfig,
  type OpenAiCompatibleConfig,
  type MimoAsrConfig,
  type DualRouteConfig,
} from "./config";
export {
  OpenAiCompatibleMemoryAssistant,
  type AiFetch,
  type OpenAiCompatibleDependencies,
} from "./openai-compatible";
export { DualRouteMemoryAssistant } from "./dual-route";
export { MimoAsrTranscriber } from "./mimo-asr";

/**
 * Runtime factory. Merely constructing an assistant performs no network I/O.
 * With no AI environment configuration it returns NullMemoryAssistant.
 */
export function createMemoryAssistant(
  env: AiEnvironment = process.env,
  dependencies: OpenAiCompatibleDependencies & { execution?: AiExecutionContext } = {},
): MemoryAssistant {
  const config = loadAiProviderConfig(env);
  if (config.kind === "disabled") return new NullMemoryAssistant();
  const guarded = { ...dependencies, dispatch: createAiDispatcher(dependencies.execution, env, dependencies.fetch) };
  if (config.kind === "dual-route") {
    return new DualRouteMemoryAssistant(config, guarded);
  }
  return new OpenAiCompatibleMemoryAssistant(config, guarded);
}
