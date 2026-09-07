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
  /**
   * M6 双路由：该能力实际接收服务的身份。单通道运行时缺省，
   * 任务/同意/披露按能力解析时回退到聚合 provider 描述符。
   */
  providerId?: string;
  providerName?: string;
  /** 分能力部署身份：只改另一条路由的配置时，本能力的同意不失效。 */
  configurationId?: string;
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
  /** Non-secret deployment identity; endpoint/config changes invalidate existing consent/jobs. */
  configurationId?: string;
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
  /**
   * 已知时长（秒）：调用方从资产元数据/探测给出，用于每日音频时长限额。
   * 缺省表示未知——限额按 0 秒计（请求数仍计），显示层如实呈现未知。
   */
  durationSeconds?: number;
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
