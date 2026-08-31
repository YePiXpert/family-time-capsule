import { createCapabilityMap, NO_AI_MODELS } from "./capabilities";
import { AiCapabilityUnavailableError } from "./errors";
import type {
  AiCapability,
  AiCapabilityMap,
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

const NULL_PROVIDER: AiProviderDescriptor = Object.freeze({
  id: "disabled",
  displayName: "AI disabled",
  external: false,
});

/** Default assistant. It performs no I/O and keeps every core flow offline. */
export class NullMemoryAssistant implements MemoryAssistant {
  readonly provider = NULL_PROVIDER;
  readonly capabilities: AiCapabilityMap = createCapabilityMap(
    NO_AI_MODELS,
    "disabled",
  );

  supports(capability: AiCapability): boolean {
    void capability;
    return false;
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    void input;
    throw new AiCapabilityUnavailableError("text");
  }

  async analyzeImage(
    input: AnalyzeImageInput,
  ): Promise<AnalyzeImageResult> {
    void input;
    throw new AiCapabilityUnavailableError("vision");
  }

  async transcribeAudio(
    input: TranscribeAudioInput,
  ): Promise<TranscribeAudioResult> {
    void input;
    throw new AiCapabilityUnavailableError("transcription");
  }

  async createEmbeddings(
    input: CreateEmbeddingsInput,
  ): Promise<CreateEmbeddingsResult> {
    void input;
    throw new AiCapabilityUnavailableError("embeddings");
  }
}
