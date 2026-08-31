/**
 * Provider-neutral AI contracts.
 *
 * These types deliberately contain no database entities. AI output is a
 * derivative; a later application service decides whether it becomes a
 * reviewable suggestion, and only a human workflow can confirm a fact.
 */

export const AI_CAPABILITIES = [
  "text",
  "vision",
  "transcription",
  "embeddings",
] as const;

export type AiCapability = (typeof AI_CAPABILITIES)[number];

export type AiCapabilityReason =
  | "configured"
  | "disabled"
  | "not_configured";

export type AiCapabilityStatus = Readonly<{
  available: boolean;
  model: string | null;
  reason: AiCapabilityReason;
}>;

export type AiCapabilityMap = Readonly<
  Record<AiCapability, AiCapabilityStatus>
>;

export type AiProviderDescriptor = Readonly<{
  /** Stable adapter identifier, never a secret. */
  id: string;
  /** Operator-facing provider label suitable for consent/disclosure UI. */
  displayName: string;
  /** Whether calls can leave the Family Time Capsule process. */
  external: boolean;
}>;

export type AiProvenance = Readonly<{
  providerId: string;
  providerName: string;
  model: string;
}>;

export type AiTokenUsage = Readonly<{
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}>;

export type AiTextRole = "system" | "user" | "assistant";

export type AiTextMessage = Readonly<{
  role: AiTextRole;
  content: string;
}>;

export type GenerateTextInput = Readonly<{
  messages: readonly AiTextMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  responseFormat?: "text" | "json";
  signal?: AbortSignal;
}>;

export type GenerateTextResult = Readonly<{
  text: string;
  finishReason: string | null;
  provenance: AiProvenance;
  usage?: AiTokenUsage;
}>;

export type AiImageInput = Readonly<{
  bytes: Uint8Array;
  mimeType: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
}>;

export type AnalyzeImageInput = Readonly<{
  image: AiImageInput;
  prompt: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}>;

export type AnalyzeImageResult = Readonly<{
  text: string;
  finishReason: string | null;
  provenance: AiProvenance;
  usage?: AiTokenUsage;
}>;

export type AiAudioInput = Readonly<{
  bytes: Uint8Array;
  fileName: string;
  mimeType:
    | "audio/flac"
    | "audio/m4a"
    | "audio/mp4"
    | "audio/mpeg"
    | "audio/ogg"
    | "audio/wav"
    | "audio/webm";
}>;

export type TranscribeAudioInput = Readonly<{
  audio: AiAudioInput;
  language?: string;
  prompt?: string;
  signal?: AbortSignal;
}>;

export type TranscriptSegment = Readonly<{
  startSeconds: number;
  endSeconds: number;
  text: string;
}>;

export type TranscribeAudioResult = Readonly<{
  text: string;
  language: string | null;
  durationSeconds: number | null;
  segments: readonly TranscriptSegment[];
  provenance: AiProvenance;
}>;

export type CreateEmbeddingsInput = Readonly<{
  inputs: readonly string[];
  signal?: AbortSignal;
}>;

export type CreateEmbeddingsResult = Readonly<{
  vectors: readonly (readonly number[])[];
  dimensions: number;
  provenance: AiProvenance;
  usage?: AiTokenUsage;
}>;

export interface TextGenerationProvider {
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
}

export interface VisionProvider {
  analyzeImage(input: AnalyzeImageInput): Promise<AnalyzeImageResult>;
}

export interface TranscriptionProvider {
  transcribeAudio(
    input: TranscribeAudioInput,
  ): Promise<TranscribeAudioResult>;
}

export interface EmbeddingProvider {
  createEmbeddings(
    input: CreateEmbeddingsInput,
  ): Promise<CreateEmbeddingsResult>;
}

/**
 * Aggregate injected into memory-organizer application services.
 *
 * Callers must inspect `supports()` before scheduling an AI operation. The
 * methods still fail closed with `AiCapabilityUnavailableError` so a missing
 * model can never silently fall through to another capability.
 */
export interface MemoryAssistant
  extends TextGenerationProvider,
    VisionProvider,
    TranscriptionProvider,
    EmbeddingProvider {
  readonly provider: AiProviderDescriptor;
  readonly capabilities: AiCapabilityMap;
  supports(capability: AiCapability): boolean;
}
