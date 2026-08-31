import {
  AI_CAPABILITIES,
  type AiCapability,
  type AiCapabilityMap,
  type AiCapabilityReason,
} from "./types";

export type AiModels = Readonly<Record<AiCapability, string | null>>;

export function createCapabilityMap(
  models: AiModels,
  unavailableReason: Exclude<AiCapabilityReason, "configured">,
): AiCapabilityMap {
  return Object.freeze(
    Object.fromEntries(
      AI_CAPABILITIES.map((capability) => {
        const model = models[capability];
        return [
          capability,
          Object.freeze({
            available: model !== null,
            model,
            reason: model === null ? unavailableReason : "configured",
          }),
        ];
      }),
    ) as Record<AiCapability, AiCapabilityMap[AiCapability]>,
  );
}

export function supportsCapability(
  capabilities: AiCapabilityMap,
  capability: AiCapability,
): boolean {
  return capabilities[capability].available;
}

export const NO_AI_MODELS: AiModels = Object.freeze({
  text: null,
  vision: null,
  transcription: null,
  embeddings: null,
});
