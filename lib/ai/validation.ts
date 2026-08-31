import { AiInputError } from "./errors";
import type {
  AnalyzeImageInput,
  CreateEmbeddingsInput,
  GenerateTextInput,
  TranscribeAudioInput,
} from "./types";

const encoder = new TextEncoder();

export const AI_INPUT_LIMITS = Object.freeze({
  maxMessages: 64,
  maxMessageCharacters: 100_000,
  maxTotalTextBytes: 1 * 1024 * 1024,
  maxImageBytes: 20 * 1024 * 1024,
  maxAudioBytes: 25 * 1024 * 1024,
  maxTranscriptionPromptCharacters: 2_000,
  maxEmbeddingInputs: 256,
  maxEmbeddingInputCharacters: 20_000,
  maxEmbeddingInputBytes: 1 * 1024 * 1024,
  maxOutputTokens: 65_536,
});

function validateSignal(signal: AbortSignal | undefined): void {
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new AiInputError("The AI abort signal is invalid.");
  }
}
function validateOutputOptions(input: {
  maxOutputTokens?: number;
  temperature?: number;
}): void {
  if (
    input.maxOutputTokens !== undefined &&
    (!Number.isInteger(input.maxOutputTokens) ||
      input.maxOutputTokens < 1 ||
      input.maxOutputTokens > AI_INPUT_LIMITS.maxOutputTokens)
  ) {
    throw new AiInputError("AI maxOutputTokens is outside the safe range.");
  }
  if (
    input.temperature !== undefined &&
    (!Number.isFinite(input.temperature) ||
      input.temperature < 0 ||
      input.temperature > 2)
  ) {
    throw new AiInputError("AI temperature must be between 0 and 2.");
  }
}

function validateHumanText(value: string, message: string): void {
  if (value.trim().length === 0 || /\u0000/u.test(value)) {
    throw new AiInputError(message);
  }
}

export function validateGenerateTextInput(input: GenerateTextInput): void {
  validateSignal(input.signal);
  validateOutputOptions(input);
  if (
    !Array.isArray(input.messages) ||
    input.messages.length === 0 ||
    input.messages.length > AI_INPUT_LIMITS.maxMessages
  ) {
    throw new AiInputError("AI text messages have an invalid count.");
  }

  let totalBytes = 0;
  for (const message of input.messages) {
    if (
      message === null ||
      typeof message !== "object" ||
      !["system", "user", "assistant"].includes(message.role)
    ) {
      throw new AiInputError("AI text message role is invalid.");
    }
    if (
      typeof message.content !== "string" ||
      message.content.length > AI_INPUT_LIMITS.maxMessageCharacters
    ) {
      throw new AiInputError("AI text message content is too large.");
    }
    validateHumanText(message.content, "AI text message content is empty.");
    totalBytes += encoder.encode(message.content).byteLength;
    if (totalBytes > AI_INPUT_LIMITS.maxTotalTextBytes) {
      throw new AiInputError("AI text input exceeds the byte limit.");
    }
  }
  if (
    input.responseFormat !== undefined &&
    input.responseFormat !== "text" &&
    input.responseFormat !== "json"
  ) {
    throw new AiInputError("AI response format is invalid.");
  }
}

export function validateAnalyzeImageInput(input: AnalyzeImageInput): void {
  validateSignal(input.signal);
  validateOutputOptions(input);
  if (typeof input.prompt !== "string") {
    throw new AiInputError("AI image prompt is invalid.");
  }
  validateHumanText(input.prompt, "AI image prompt is empty.");
  if (encoder.encode(input.prompt).byteLength > AI_INPUT_LIMITS.maxTotalTextBytes) {
    throw new AiInputError("AI image prompt exceeds the byte limit.");
  }
  if (!(input.image.bytes instanceof Uint8Array)) {
    throw new AiInputError("AI image bytes are invalid.");
  }
  if (
    input.image.bytes.byteLength === 0 ||
    input.image.bytes.byteLength > AI_INPUT_LIMITS.maxImageBytes
  ) {
    throw new AiInputError("AI image exceeds the byte limit.");
  }
  if (
    !["image/gif", "image/jpeg", "image/png", "image/webp"].includes(
      input.image.mimeType,
    )
  ) {
    throw new AiInputError("AI image MIME type is unsupported.");
  }
}

export function validateTranscribeAudioInput(
  input: TranscribeAudioInput,
): void {
  validateSignal(input.signal);
  if (!(input.audio.bytes instanceof Uint8Array)) {
    throw new AiInputError("AI audio bytes are invalid.");
  }
  if (
    input.audio.bytes.byteLength === 0 ||
    input.audio.bytes.byteLength > AI_INPUT_LIMITS.maxAudioBytes
  ) {
    throw new AiInputError("AI audio exceeds the byte limit.");
  }
  if (
    ![
      "audio/flac",
      "audio/m4a",
      "audio/mp4",
      "audio/mpeg",
      "audio/ogg",
      "audio/wav",
      "audio/webm",
    ].includes(input.audio.mimeType)
  ) {
    throw new AiInputError("AI audio MIME type is unsupported.");
  }
  if (
    typeof input.audio.fileName !== "string" ||
    input.audio.fileName.trim().length === 0 ||
    input.audio.fileName.length > 255 ||
    /[\u0000-\u001f\u007f]/u.test(input.audio.fileName)
  ) {
    throw new AiInputError("AI audio file name is invalid.");
  }
  if (
    input.language !== undefined &&
    (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(input.language) ||
      input.language.length > 35)
  ) {
    throw new AiInputError("AI transcription language is invalid.");
  }
  if (input.prompt !== undefined) {
    if (
      typeof input.prompt !== "string" ||
      input.prompt.length > AI_INPUT_LIMITS.maxTranscriptionPromptCharacters
    ) {
      throw new AiInputError("AI transcription prompt is too large.");
    }
    validateHumanText(input.prompt, "AI transcription prompt is empty.");
  }
}

export function validateCreateEmbeddingsInput(
  input: CreateEmbeddingsInput,
): void {
  validateSignal(input.signal);
  if (
    !Array.isArray(input.inputs) ||
    input.inputs.length === 0 ||
    input.inputs.length > AI_INPUT_LIMITS.maxEmbeddingInputs
  ) {
    throw new AiInputError("AI embedding input count is invalid.");
  }
  let totalBytes = 0;
  for (const value of input.inputs) {
    if (
      typeof value !== "string" ||
      value.length > AI_INPUT_LIMITS.maxEmbeddingInputCharacters
    ) {
      throw new AiInputError("AI embedding input is too large.");
    }
    validateHumanText(value, "AI embedding input is empty.");
    totalBytes += encoder.encode(value).byteLength;
    if (totalBytes > AI_INPUT_LIMITS.maxEmbeddingInputBytes) {
      throw new AiInputError("AI embedding input exceeds the byte limit.");
    }
  }
}
