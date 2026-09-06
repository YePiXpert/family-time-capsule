import "server-only";

import { createHash } from "node:crypto";
import type { DualRouteConfig } from "./config";
import { MimoAsrTranscriber } from "./mimo-asr";
import {
  OpenAiCompatibleMemoryAssistant,
  type OpenAiCompatibleDependencies,
} from "./openai-compatible";
import { supportsCapability } from "./capabilities";
import type {
  AiCapability,
  AiProviderDescriptor,
  AnalyzeImageInput,
  AnalyzeImageResult,
  CreateEmbeddingsInput,
  CreateEmbeddingsResult,
  GenerateTextInput,
  GenerateTextResult,
  MemoryAssistant,
  TranscribeAudioInput,
  TranscribeAudioResult,
} from "./types";
import { assertAiServerRuntime } from "./server-runtime";

/**
 * M6 双路由复合 assistant：
 * - 文字 / 图片 / embeddings → CPA（Luna）主通道；
 * - 语音转写 → MiMo ASR 通道。
 *
 * provider 聚合描述符 id 为 "dual-route"，仅用于整体有效性标识；
 * 任务、同意与披露按能力解析实际接收方（capabilities[*].providerId /
 * providerName / configurationId），因此只改一条路由的配置不会让另一条
 * 的历史同意静默失效。
 */
export class DualRouteMemoryAssistant implements MemoryAssistant {
  readonly provider: AiProviderDescriptor;
  readonly capabilities: DualRouteConfig["capabilities"];

  readonly #primary: OpenAiCompatibleMemoryAssistant;
  readonly #asr: MimoAsrTranscriber;

  constructor(
    config: DualRouteConfig,
    dependencies: OpenAiCompatibleDependencies = {},
  ) {
    assertAiServerRuntime();
    this.#primary = new OpenAiCompatibleMemoryAssistant(
      config.primary,
      dependencies,
    );
    this.#asr = new MimoAsrTranscriber(config.asr, dependencies);
    this.provider = Object.freeze({
      id: "dual-route",
      displayName: `${config.primary.providerLabel} + ${config.asr.providerLabel}`,
      external: true,
      configurationId: createHash("sha256")
        .update(
          JSON.stringify({
            primary: config.primary.configurationId,
            asr: config.asr.configurationId,
          }),
        )
        .digest("hex"),
    });
    this.capabilities = config.capabilities;
  }

  supports(capability: AiCapability): boolean {
    return supportsCapability(this.capabilities, capability);
  }

  generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    return this.#primary.generateText(input);
  }

  analyzeImage(input: AnalyzeImageInput): Promise<AnalyzeImageResult> {
    return this.#primary.analyzeImage(input);
  }

  transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeAudioResult> {
    return this.#asr.transcribeAudio(input);
  }

  createEmbeddings(
    input: CreateEmbeddingsInput,
  ): Promise<CreateEmbeddingsResult> {
    return this.#primary.createEmbeddings(input);
  }
}
