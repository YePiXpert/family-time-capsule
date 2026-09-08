import "server-only";

import { Buffer } from "node:buffer";
import { AiInputError, AiProviderError } from "./errors";
import type { MimoAsrConfig } from "./config";
import {
  OpenAiCompatibleTransport,
  type AiFetch,
  type OpenAiCompatibleDependencies,
} from "./openai-compatible";
import type {
  AiProviderDescriptor,
  AiProvenance,
  TranscribeAudioInput,
  TranscribeAudioResult,
} from "./types";
import { validateTranscribeAudioInput } from "./validation";
import { assertAiServerRuntime } from "./server-runtime";

/**
 * MiMo-V2.5-ASR 适配器（M6 语音路由）。
 *
 * 按小米官方契约实现，刻意不沿用 OpenAI /audio/transcriptions 的
 * multipart 形态：
 * - POST {baseUrl}/chat/completions；
 * - messages[0].content[0] = { type: "input_audio", input_audio: { data,
 *   "data:<mime>;base64,…", format } }（仅支持单条音频）；
 * - 认证头 api-key（Bearer 为文档备选，不默认使用）；
 * - 仅接受 mp3 与 wav；其它格式由调用方（转写任务）先转成 wav；
 * - 响应文本在 choices[0].message.content；usage.seconds 为音频总时长；
 * - 响应不含逐段时间戳 → segments 恒为空数组，绝不虚构定位。
 */

const MIMO_AUDIO_FORMATS: readonly {
  mime: TranscribeAudioInput["audio"]["mimeType"];
  format: "mp3" | "wav";
}[] = [
  { mime: "audio/mpeg", format: "mp3" },
  { mime: "audio/wav", format: "wav" },
];

function mimoFormatFor(
  mimeType: TranscribeAudioInput["audio"]["mimeType"],
): "mp3" | "wav" | null {
  for (const entry of MIMO_AUDIO_FORMATS) {
    if (entry.mime === mimeType) return entry.format;
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMimoChatCompletion(
  value: unknown,
  configuredLanguage: MimoAsrConfig["language"],
  provenance: () => AiProvenance,
): TranscribeAudioResult {
  if (!isObject(value) || !Array.isArray(value.choices)) {
    throw new AiProviderError({
      capability: "transcription",
      code: "ai_response_invalid",
      message: "MiMo ASR response is not a chat.completion object.",
      retryable: false,
    });
  }
  const choice = value.choices[0] as unknown;
  if (!isObject(choice) || !isObject(choice.message)) {
    throw new AiProviderError({
      capability: "transcription",
      code: "ai_response_invalid",
      message: "MiMo ASR response has no message.",
      retryable: false,
    });
  }
  const content = choice.message.content;
  if (choice.finish_reason !== "stop") throw new AiProviderError({ capability: "transcription", code: "ai_response_invalid", message: "MiMo ASR did not return a complete transcript.", retryable: false });
  if (typeof content !== "string") {
    throw new AiProviderError({
      capability: "transcription",
      code: "ai_response_invalid",
      message: "MiMo ASR message content is not text.",
      retryable: false,
    });
  }
  const usage = isObject(value.usage) ? value.usage : {};
  const seconds = usage.seconds;
  const durationSeconds =
    typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
      ? seconds
      : null;
  return {
    text: content,
    // 官方响应不回传实际语种；auto 时如实为 null，配置 zh/en 时为已知设定值。
    language: configuredLanguage === "auto" ? null : configuredLanguage,
    durationSeconds,
    segments: [],
    provenance: provenance(),
  };
}

export type MimoAsrDependencies = Readonly<{
  fetch?: AiFetch;
  dispatch?: OpenAiCompatibleDependencies["dispatch"];
}>;

export class MimoAsrTranscriber {
  readonly provider: AiProviderDescriptor;
  readonly model: string;
  readonly language: MimoAsrConfig["language"];

  readonly #config: MimoAsrConfig;
  readonly #transport: OpenAiCompatibleTransport;

  constructor(config: MimoAsrConfig, dependencies: MimoAsrDependencies = {}) {
    assertAiServerRuntime();
    this.#config = config;
    this.model = config.model;
    this.language = config.language;
    // 传输层复用主适配器的超时/有界读取/错误映射；认证头换成 MiMo 的 api-key。
    this.#transport = new OpenAiCompatibleTransport(
      {
        kind: "openai-compatible",
        baseUrl: config.baseUrl,
        configurationId: config.configurationId,
        apiKey: config.apiKey,
        providerLabel: config.providerLabel,
        models: { text: null, vision: null, transcription: config.model, embeddings: null },
        capabilities: Object.freeze({
          text: Object.freeze({ available: false, model: null, reason: "not_configured" as const }),
          vision: Object.freeze({ available: false, model: null, reason: "not_configured" as const }),
          transcription: Object.freeze({ available: true, model: config.model, reason: "configured" as const }),
          embeddings: Object.freeze({ available: false, model: null, reason: "not_configured" as const }),
        }),
        requestTimeoutMs: config.requestTimeoutMs,
        maxRequestBytes: config.maxRequestBytes,
        maxResponseBytes: config.maxResponseBytes,
        tokenParameter: "max_tokens",
        temperatureSupported: false,
        jsonMode: "prompt_only",
        transcriptionFormat: "json",
        textProfile: "chat_completions",
        visionProfile: "chat_completions",
      },
      dependencies as OpenAiCompatibleDependencies,
      { "api-key": config.apiKey.revealForProvider() },
    );
    this.provider = Object.freeze({
      id: "mimo-asr",
      displayName: config.providerLabel,
      external: true,
      configurationId: config.configurationId,
    });
  }

  #provenance(): AiProvenance {
    return {
      providerId: "mimo-asr",
      providerName: this.#config.providerLabel,
      model: this.#config.model,
    };
  }

  async transcribeAudio(
    input: TranscribeAudioInput,
  ): Promise<TranscribeAudioResult> {
    validateTranscribeAudioInput(input);
    const format = mimoFormatFor(input.audio.mimeType);
    if (format === null) {
      // 调用方（转写任务）应先把非 mp3/wav 音频转成 wav；这里是最后防线。
      throw new AiInputError(
        `MiMo 语音识别仅支持 mp3 与 wav，收到 ${input.audio.mimeType}。`,
      );
    }
    // Official guide limits the Base64 string to 10 MB; enforce before allocating
    // the JSON body or reserving quota. https://mimo.mi.com/docs/en-US/quick-start/usage-guide/audio/Speech-Recognition
    if (4 * Math.ceil(input.audio.bytes.byteLength / 3) > 10_000_000) throw new AiInputError("MiMo 音频编码后超过 10 MB，请使用更小的完整音频或分段转写。");
    const dataUrl = `data:${input.audio.mimeType};base64,${Buffer.from(
      input.audio.bytes,
    ).toString("base64")}`;
    const body = {
      model: this.#config.model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: { data: dataUrl, format },
            },
          ],
        },
      ],
      ...(this.#config.language !== "auto"
        ? { asr_options: { language: this.#config.language } }
        : {}),
      stream: false,
    };
    const value = await this.#transport.postJson(
      "transcription",
      "chat/completions",
      body,
      input.signal,
      input.audio,
    );
    return parseMimoChatCompletion(
      value,
      this.#config.language,
      () => this.#provenance(),
    );
  }
}
