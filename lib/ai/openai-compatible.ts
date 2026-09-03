import "server-only";

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { AiCapabilityUnavailableError, AiError, AiInputError, AiProviderError } from "./errors";
import type { OpenAiCompatibleConfig } from "./config";
import { supportsCapability } from "./capabilities";
import type {
  AiCapability,
  AiProviderDescriptor,
  AiProvenance,
  AiTokenUsage,
  AnalyzeImageInput,
  AnalyzeImageResult,
  CreateEmbeddingsInput,
  CreateEmbeddingsResult,
  GenerateTextInput,
  GenerateTextResult,
  MemoryAssistant,
  TranscriptSegment,
  TranscribeAudioInput,
  TranscribeAudioResult,
} from "./types";
import {
  validateAnalyzeImageInput,
  validateCreateEmbeddingsInput,
  validateGenerateTextInput,
  validateTranscribeAudioInput,
} from "./validation";
import { assertAiServerRuntime } from "./server-runtime";

export type AiFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type OpenAiCompatibleDependencies = Readonly<{
  fetch?: AiFetch;
}>;

type JsonObject = Record<string, unknown>;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const ABORTED = Symbol("AI request aborted");

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeRequestId(response: Response): string | null {
  const requestId =
    response.headers.get("x-request-id") ??
    response.headers.get("request-id") ??
    response.headers.get("x-correlation-id");
  if (
    requestId === null ||
    !/^[A-Za-z0-9._:-]{1,128}$/u.test(requestId)
  ) {
    return null;
  }
  // Response headers are controlled by the remote provider. Never expose the
  // raw value: a hostile endpoint that has seen our Authorization header could
  // reflect the API key as x-request-id and make an otherwise safe error log it.
  return `sha256:${createHash("sha256").update(requestId).digest("hex").slice(0, 24)}`;
}

function retryableHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function responseContentTypeIsJson(response: Response): boolean {
  const raw = response.headers.get("content-type");
  if (raw === null) return false;
  const mediaType = raw.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" || mediaType?.endsWith("+json") === true;
}

async function readBoundedJson(
  response: Response,
  capability: AiCapability,
  maxBytes: number,
): Promise<unknown> {
  if (!responseContentTypeIsJson(response)) {
    void response.body?.cancel();
    throw new AiProviderError({
      capability,
      code: "ai_response_invalid",
      message: "AI provider response was not JSON.",
      retryable: false,
      status: response.status,
      requestId: safeRequestId(response),
    });
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) {
      void response.body?.cancel();
      throw new AiProviderError({
        capability,
        code: "ai_response_invalid",
        message: "AI provider response length was invalid.",
        retryable: false,
        status: response.status,
        requestId: safeRequestId(response),
      });
    }
    if (Number(contentLength) > maxBytes) {
      void response.body?.cancel();
      throw new AiProviderError({
        capability,
        code: "ai_response_too_large",
        message: "AI provider response exceeded the configured size limit.",
        retryable: false,
        status: response.status,
        requestId: safeRequestId(response),
      });
    }
  }

  const chunks: Uint8Array[] = [];
  let length = 0;
  if (response.body !== null) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) {
          await reader.cancel();
          throw new AiProviderError({
            capability,
            code: "ai_response_too_large",
            message: "AI provider response exceeded the configured size limit.",
            retryable: false,
            status: response.status,
            requestId: safeRequestId(response),
          });
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new AiProviderError({
      capability,
      code: "ai_response_invalid",
      message: "AI provider response was not valid UTF-8.",
      retryable: false,
      status: response.status,
      requestId: safeRequestId(response),
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AiProviderError({
      capability,
      code: "ai_response_invalid",
      message: "AI provider returned malformed JSON.",
      retryable: false,
      status: response.status,
      requestId: safeRequestId(response),
    });
  }
}

function responseError(capability: AiCapability, message: string): AiProviderError {
  return new AiProviderError({
    capability,
    code: "ai_response_invalid",
    message,
    retryable: false,
  });
}

function parseUsage(value: unknown, capability: AiCapability): AiTokenUsage | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    throw responseError(capability, "AI provider usage metadata was invalid.");
  }
  const readCount = (...names: string[]): number | undefined => {
    for (const name of names) {
      const count = value[name];
      if (count !== undefined) {
        if (!Number.isInteger(count) || (count as number) < 0) {
          throw responseError(capability, "AI provider usage metadata was invalid.");
        }
        return count as number;
      }
    }
    return undefined;
  };
  const usage: AiTokenUsage = {
    inputTokens: readCount("prompt_tokens", "input_tokens"),
    outputTokens: readCount("completion_tokens", "output_tokens"),
    totalTokens: readCount("total_tokens"),
  };
  return Object.freeze(usage);
}

function readResponseModel(
  value: unknown,
  fallback: string,
  capability: AiCapability,
): string {
  if (value === undefined) return fallback;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw responseError(capability, "AI provider model metadata was invalid.");
  }
  return value;
}

function readChatText(value: unknown, capability: AiCapability): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && value.length > 0) {
    const parts = value.map((part) => {
      if (
        !isObject(part) ||
        part.type !== "text" ||
        typeof part.text !== "string" ||
        part.text.length === 0
      ) {
        throw responseError(capability, "AI provider text content was invalid.");
      }
      return part.text;
    });
    const text = parts.join("");
    if (text.length > 0) return text;
  }
  throw responseError(capability, "AI provider text content was missing.");
}

function parseChatResponse(
  value: unknown,
  capability: "text" | "vision",
  fallbackModel: string,
  provenanceFor: (model: string) => AiProvenance,
): GenerateTextResult | AnalyzeImageResult {
  if (!isObject(value) || !Array.isArray(value.choices) || value.choices.length === 0) {
    throw responseError(capability, "AI provider choices were missing.");
  }
  const choice = value.choices[0];
  if (!isObject(choice) || !isObject(choice.message)) {
    throw responseError(capability, "AI provider choice was invalid.");
  }
  const text = readChatText(choice.message.content, capability);
  const finishReason = choice.finish_reason;
  if (
    finishReason !== undefined &&
    finishReason !== null &&
    (typeof finishReason !== "string" || finishReason.length > 100)
  ) {
    throw responseError(capability, "AI provider finish reason was invalid.");
  }
  const model = readResponseModel(value.model, fallbackModel, capability);
  const usage = parseUsage(value.usage, capability);
  return Object.freeze({
    text,
    finishReason: finishReason ?? null,
    provenance: provenanceFor(model),
    ...(usage === undefined ? {} : { usage }),
  });
}

function parseSegments(value: unknown): readonly TranscriptSegment[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw responseError("transcription", "AI transcript segments were invalid.");
  }
  return Object.freeze(
    value.map((segment) => {
      if (
        !isObject(segment) ||
        typeof segment.start !== "number" ||
        !Number.isFinite(segment.start) ||
        segment.start < 0 ||
        typeof segment.end !== "number" ||
        !Number.isFinite(segment.end) ||
        segment.end < segment.start ||
        typeof segment.text !== "string" ||
        segment.text.length === 0
      ) {
        throw responseError("transcription", "AI transcript segment was invalid.");
      }
      return Object.freeze({
        startSeconds: segment.start,
        endSeconds: segment.end,
        text: segment.text,
      });
    }),
  );
}

function parseTranscriptionResponse(
  value: unknown,
  fallbackModel: string,
  provenanceFor: (model: string) => AiProvenance,
): TranscribeAudioResult {
  if (!isObject(value) || typeof value.text !== "string" || value.text.length === 0) {
    throw responseError("transcription", "AI transcript text was missing.");
  }
  if (
    value.language !== undefined &&
    (typeof value.language !== "string" || value.language.length > 100)
  ) {
    throw responseError("transcription", "AI transcript language was invalid.");
  }
  if (
    value.duration !== undefined &&
    (typeof value.duration !== "number" ||
      !Number.isFinite(value.duration) ||
      value.duration < 0)
  ) {
    throw responseError("transcription", "AI transcript duration was invalid.");
  }
  const model = readResponseModel(value.model, fallbackModel, "transcription");
  return Object.freeze({
    text: value.text,
    language: value.language ?? null,
    durationSeconds: value.duration ?? null,
    segments: parseSegments(value.segments),
    provenance: provenanceFor(model),
  });
}

function parseEmbeddingResponse(
  value: unknown,
  expectedCount: number,
  fallbackModel: string,
  provenanceFor: (model: string) => AiProvenance,
): CreateEmbeddingsResult {
  if (!isObject(value) || !Array.isArray(value.data) || value.data.length !== expectedCount) {
    throw responseError("embeddings", "AI embedding count was invalid.");
  }
  const vectors: Array<readonly number[] | undefined> = new Array(expectedCount);
  let dimensions: number | null = null;
  for (const item of value.data) {
    if (
      !isObject(item) ||
      !Number.isInteger(item.index) ||
      (item.index as number) < 0 ||
      (item.index as number) >= expectedCount ||
      !Array.isArray(item.embedding) ||
      item.embedding.length === 0 ||
      item.embedding.length > 65_536 ||
      item.embedding.some(
        (component) => typeof component !== "number" || !Number.isFinite(component),
      )
    ) {
      throw responseError("embeddings", "AI embedding vector was invalid.");
    }
    const index = item.index as number;
    if (vectors[index] !== undefined) {
      throw responseError("embeddings", "AI embedding index was duplicated.");
    }
    if (dimensions !== null && dimensions !== item.embedding.length) {
      throw responseError("embeddings", "AI embedding dimensions were inconsistent.");
    }
    dimensions = item.embedding.length;
    vectors[index] = Object.freeze([...(item.embedding as number[])]);
  }
  if (dimensions === null || vectors.some((vector) => vector === undefined)) {
    throw responseError("embeddings", "AI embedding indexes were incomplete.");
  }
  const model = readResponseModel(value.model, fallbackModel, "embeddings");
  const usage = parseUsage(value.usage, "embeddings");
  return Object.freeze({
    vectors: Object.freeze(vectors as readonly (readonly number[])[]),
    dimensions,
    provenance: provenanceFor(model),
    ...(usage === undefined ? {} : { usage }),
  });
}

function extensionForAudio(mimeType: TranscribeAudioInput["audio"]["mimeType"]): string {
  switch (mimeType) {
    case "audio/flac":
      return "flac";
    case "audio/m4a":
      return "m4a";
    case "audio/mp4":
      return "mp4";
    case "audio/mpeg":
      return "mp3";
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
      return "wav";
    case "audio/webm":
      return "webm";
  }
}

class OpenAiCompatibleTransport {
  readonly #config: OpenAiCompatibleConfig;
  readonly #fetch: AiFetch;

  constructor(config: OpenAiCompatibleConfig, dependencies: OpenAiCompatibleDependencies) {
    this.#config = config;
    this.#fetch = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  }

  #endpoint(path: string): string {
    return new URL(path, `${this.#config.baseUrl}/`).toString();
  }

  #headers(contentType: boolean): Headers {
    const headers = new Headers({
      accept: "application/json",
      authorization: `Bearer ${this.#config.apiKey.revealForProvider()}`,
    });
    if (contentType) headers.set("content-type", "application/json");
    return headers;
  }

  async #request(
    capability: AiCapability,
    endpoint: string,
    init: RequestInit,
    externalSignal: AbortSignal | undefined,
  ): Promise<unknown> {
    if (externalSignal?.aborted === true) {
      throw new AiProviderError({
        capability,
        code: "ai_aborted",
        message: "AI request was aborted by the caller.",
        retryable: false,
      });
    }

    const controller = new AbortController();
    let abortKind: "caller" | "timeout" | null = null;
    const onExternalAbort = (): void => {
      abortKind = "caller";
      controller.abort();
    };
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    const timeout = setTimeout(() => {
      abortKind = "timeout";
      controller.abort();
    }, this.#config.requestTimeoutMs);
    const abortPromise = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(ABORTED), {
        once: true,
      });
    });

    const operation = (async (): Promise<unknown> => {
      const response = await this.#fetch(this.#endpoint(endpoint), {
        ...init,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        void response.body?.cancel();
        throw new AiProviderError({
          capability,
          code: "ai_provider_http_error",
          message: `AI provider returned HTTP ${response.status}.`,
          retryable: retryableHttpStatus(response.status),
          status: response.status,
          requestId: safeRequestId(response),
        });
      }
      return readBoundedJson(response, capability, this.#config.maxResponseBytes);
    })();

    try {
      return await Promise.race([operation, abortPromise]);
    } catch (error) {
      if (error instanceof AiError) throw error;
      if (abortKind === "caller" || error === ABORTED) {
        if (abortKind === "timeout") {
          throw new AiProviderError({
            capability,
            code: "ai_timeout",
            message: "AI provider request timed out.",
            retryable: true,
          });
        }
        throw new AiProviderError({
          capability,
          code: "ai_aborted",
          message: "AI request was aborted by the caller.",
          retryable: false,
        });
      }
      if (abortKind === "timeout") {
        throw new AiProviderError({
          capability,
          code: "ai_timeout",
          message: "AI provider request timed out.",
          retryable: true,
        });
      }
      // Do not attach or stringify the transport error: custom fetch
      // implementations and proxies can include Authorization values in it.
      throw new AiProviderError({
        capability,
        code: "ai_network_error",
        message: "AI provider request failed before a valid response arrived.",
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  async postJson(
    capability: AiCapability,
    endpoint: string,
    body: JsonObject,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    const json = JSON.stringify(body);
    if (encoder.encode(json).byteLength > this.#config.maxRequestBytes) {
      throw new AiInputError("AI request exceeds the configured size limit.");
    }
    return this.#request(
      capability,
      endpoint,
      { method: "POST", headers: this.#headers(true), body: json },
      signal,
    );
  }

  async postForm(
    capability: AiCapability,
    endpoint: string,
    body: FormData,
    approximateBytes: number,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    if (approximateBytes > this.#config.maxRequestBytes) {
      throw new AiInputError("AI request exceeds the configured size limit.");
    }
    return this.#request(
      capability,
      endpoint,
      { method: "POST", headers: this.#headers(false), body },
      signal,
    );
  }
}

export class OpenAiCompatibleMemoryAssistant implements MemoryAssistant {
  readonly provider: AiProviderDescriptor;
  readonly capabilities: OpenAiCompatibleConfig["capabilities"];

  readonly #config: OpenAiCompatibleConfig;
  readonly #transport: OpenAiCompatibleTransport;

  constructor(
    config: OpenAiCompatibleConfig,
    dependencies: OpenAiCompatibleDependencies = {},
  ) {
    assertAiServerRuntime();
    this.#config = config;
    this.#transport = new OpenAiCompatibleTransport(config, dependencies);
    this.provider = Object.freeze({
      id: "openai-compatible",
      displayName: config.providerLabel,
      external: true,
    });
    this.capabilities = config.capabilities;
  }

  supports(capability: AiCapability): boolean {
    return supportsCapability(this.capabilities, capability);
  }

  #model(capability: AiCapability): string {
    const model = this.#config.models[capability];
    if (model === null) throw new AiCapabilityUnavailableError(capability);
    return model;
  }

  #provenance(model: string): AiProvenance {
    return Object.freeze({
      providerId: this.provider.id,
      providerName: this.provider.displayName,
      model,
    });
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const model = this.#model("text");
    validateGenerateTextInput(input);
    const value = await this.#transport.postJson(
      "text",
      "chat/completions",
      {
        model,
        messages: input.messages.map((message) => ({ ...message })),
        ...(input.maxOutputTokens === undefined
          ? {}
          : { max_tokens: input.maxOutputTokens }),
        ...(input.temperature === undefined
          ? {}
          : { temperature: input.temperature }),
        ...(input.responseFormat === "json"
          ? { response_format: { type: "json_object" } }
          : {}),
      },
      input.signal,
    );
    return parseChatResponse(
      value,
      "text",
      model,
      this.#provenance.bind(this),
    ) as GenerateTextResult;
  }

  async analyzeImage(input: AnalyzeImageInput): Promise<AnalyzeImageResult> {
    const model = this.#model("vision");
    validateAnalyzeImageInput(input);
    const base64 = Buffer.from(
      input.image.bytes.buffer,
      input.image.bytes.byteOffset,
      input.image.bytes.byteLength,
    ).toString("base64");
    const value = await this.#transport.postJson(
      "vision",
      "chat/completions",
      {
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: input.prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:${input.image.mimeType};base64,${base64}`,
                },
              },
            ],
          },
        ],
        ...(input.maxOutputTokens === undefined
          ? {}
          : { max_tokens: input.maxOutputTokens }),
      },
      input.signal,
    );
    return parseChatResponse(
      value,
      "vision",
      model,
      this.#provenance.bind(this),
    ) as AnalyzeImageResult;
  }

  async transcribeAudio(
    input: TranscribeAudioInput,
  ): Promise<TranscribeAudioResult> {
    const model = this.#model("transcription");
    validateTranscribeAudioInput(input);
    const form = new FormData();
    form.set("model", model);
    form.set("response_format", "verbose_json");
    if (input.language !== undefined) form.set("language", input.language);
    if (input.prompt !== undefined) form.set("prompt", input.prompt);
    const fileBytes = new Uint8Array(input.audio.bytes);
    form.set(
      "file",
      new Blob([fileBytes], { type: input.audio.mimeType }),
      `audio.${extensionForAudio(input.audio.mimeType)}`,
    );
    const approximateBytes =
      input.audio.bytes.byteLength +
      encoder.encode(model).byteLength +
      encoder.encode(input.language ?? "").byteLength +
      encoder.encode(input.prompt ?? "").byteLength +
      4096;
    const value = await this.#transport.postForm(
      "transcription",
      "audio/transcriptions",
      form,
      approximateBytes,
      input.signal,
    );
    return parseTranscriptionResponse(
      value,
      model,
      this.#provenance.bind(this),
    );
  }

  async createEmbeddings(
    input: CreateEmbeddingsInput,
  ): Promise<CreateEmbeddingsResult> {
    const model = this.#model("embeddings");
    validateCreateEmbeddingsInput(input);
    const value = await this.#transport.postJson(
      "embeddings",
      "embeddings",
      { model, input: [...input.inputs], encoding_format: "float" },
      input.signal,
    );
    return parseEmbeddingResponse(
      value,
      input.inputs.length,
      model,
      this.#provenance.bind(this),
    );
  }
}
