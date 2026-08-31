import { createCapabilityMap, type AiModels } from "./capabilities";
import { AiCapabilityUnavailableError, AiProviderError } from "./errors";
import type {
  AiCapability,
  AiCapabilityMap,
  AiProviderDescriptor,
  AiProvenance,
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
import {
  validateAnalyzeImageInput,
  validateCreateEmbeddingsInput,
  validateGenerateTextInput,
  validateTranscribeAudioInput,
} from "./validation";

const encoder = new TextEncoder();

const DEFAULT_FAKE_MODELS: Readonly<Record<AiCapability, string>> =
  Object.freeze({
    text: "deterministic-text-v1",
    vision: "deterministic-vision-v1",
    transcription: "deterministic-transcription-v1",
    embeddings: "deterministic-embeddings-v1",
  });

export type DeterministicFakeOptions = Readonly<{
  seed?: string;
  embeddingDimensions?: number;
  capabilities?: Readonly<Partial<Record<AiCapability, boolean>>>;
}>;

function hashBytes(seed: string, chunks: readonly Uint8Array[]): number {
  let hash = 0x811c9dc5;
  const consume = (byte: number): void => {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (const byte of encoder.encode(seed)) consume(byte);
  for (const chunk of chunks) {
    consume(0xff);
    consume(chunk.byteLength & 0xff);
    consume((chunk.byteLength >>> 8) & 0xff);
    consume((chunk.byteLength >>> 16) & 0xff);
    consume((chunk.byteLength >>> 24) & 0xff);
    for (const byte of chunk) consume(byte);
  }
  return hash >>> 0;
}

function fingerprint(seed: string, chunks: readonly Uint8Array[]): string {
  return hashBytes(seed, chunks).toString(16).padStart(8, "0");
}

function nextState(state: number): number {
  let value = state || 0x6d2b79f5;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function freezeVector(values: number[]): readonly number[] {
  return Object.freeze(values);
}

function rejectPreCancelled(
  capability: AiCapability,
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted) {
    throw new AiProviderError({
      capability,
      code: "ai_aborted",
      message: "AI request was aborted by the caller.",
      retryable: false,
    });
  }
}

export class DeterministicFakeMemoryAssistant implements MemoryAssistant {
  readonly provider: AiProviderDescriptor = Object.freeze({
    id: "deterministic-fake",
    displayName: "Deterministic offline fake",
    external: false,
  });
  readonly capabilities: AiCapabilityMap;

  readonly #seed: string;
  readonly #embeddingDimensions: number;
  readonly #models: AiModels;

  constructor(options: DeterministicFakeOptions = {}) {
    if (
      options.seed !== undefined &&
      (options.seed.length === 0 || options.seed.length > 256)
    ) {
      throw new RangeError("Fake AI seed must contain 1 to 256 characters.");
    }
    const dimensions = options.embeddingDimensions ?? 8;
    if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 4096) {
      throw new RangeError("Fake AI embedding dimensions are invalid.");
    }
    this.#seed = options.seed ?? "family-time-capsule";
    this.#embeddingDimensions = dimensions;
    this.#models = Object.freeze(
      Object.fromEntries(
        Object.entries(DEFAULT_FAKE_MODELS).map(([capability, model]) => [
          capability,
          options.capabilities?.[capability as AiCapability] === false
            ? null
            : model,
        ]),
      ) as Record<AiCapability, string | null>,
    );
    this.capabilities = createCapabilityMap(this.#models, "not_configured");
  }

  supports(capability: AiCapability): boolean {
    return this.capabilities[capability].available;
  }

  #provenance(capability: AiCapability): AiProvenance {
    const model = this.#models[capability];
    if (model === null) throw new AiCapabilityUnavailableError(capability);
    return Object.freeze({
      providerId: this.provider.id,
      providerName: this.provider.displayName,
      model,
    });
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const provenance = this.#provenance("text");
    validateGenerateTextInput(input);
    rejectPreCancelled("text", input.signal);
    const chunks = [
      ...input.messages.flatMap((message) => [
        encoder.encode(message.role),
        encoder.encode(message.content),
      ]),
      encoder.encode(`max:${input.maxOutputTokens ?? "default"}`),
      encoder.encode(`temperature:${input.temperature ?? "default"}`),
      encoder.encode(`format:${input.responseFormat ?? "text"}`),
    ];
    const id = fingerprint(`${this.#seed}:text`, chunks);
    return Object.freeze({
      text:
        input.responseFormat === "json"
          ? JSON.stringify({ fake: true, id })
          : `Deterministic fake text ${id}`,
      finishReason: "stop",
      provenance,
    });
  }

  async analyzeImage(input: AnalyzeImageInput): Promise<AnalyzeImageResult> {
    const provenance = this.#provenance("vision");
    validateAnalyzeImageInput(input);
    rejectPreCancelled("vision", input.signal);
    const id = fingerprint(`${this.#seed}:vision`, [
      encoder.encode(input.prompt),
      encoder.encode(`max:${input.maxOutputTokens ?? "default"}`),
      encoder.encode(input.image.mimeType),
      input.image.bytes,
    ]);
    return Object.freeze({
      text: `Deterministic fake image analysis ${id}`,
      finishReason: "stop",
      provenance,
    });
  }

  async transcribeAudio(
    input: TranscribeAudioInput,
  ): Promise<TranscribeAudioResult> {
    const provenance = this.#provenance("transcription");
    validateTranscribeAudioInput(input);
    rejectPreCancelled("transcription", input.signal);
    const id = fingerprint(`${this.#seed}:transcription`, [
      encoder.encode(input.audio.mimeType),
      encoder.encode(`language:${input.language ?? "auto"}`),
      encoder.encode(`prompt:${input.prompt ?? ""}`),
      input.audio.bytes,
    ]);
    return Object.freeze({
      text: `Deterministic fake transcript ${id}`,
      language: input.language ?? null,
      durationSeconds: null,
      segments: Object.freeze([]),
      provenance,
    });
  }

  async createEmbeddings(
    input: CreateEmbeddingsInput,
  ): Promise<CreateEmbeddingsResult> {
    const provenance = this.#provenance("embeddings");
    validateCreateEmbeddingsInput(input);
    rejectPreCancelled("embeddings", input.signal);
    const vectors = input.inputs.map((value) => {
      let state = hashBytes(`${this.#seed}:embeddings`, [encoder.encode(value)]);
      const vector: number[] = [];
      for (let index = 0; index < this.#embeddingDimensions; index += 1) {
        state = nextState(state);
        vector.push((state / 0xffffffff) * 2 - 1);
      }
      const norm = Math.sqrt(
        vector.reduce((sum, component) => sum + component * component, 0),
      );
      return freezeVector(vector.map((component) => component / norm));
    });
    return Object.freeze({
      vectors: Object.freeze(vectors),
      dimensions: this.#embeddingDimensions,
      provenance,
    });
  }
}
