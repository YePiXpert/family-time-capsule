import { describe, expect, it } from "vitest";
import {
  AiCapabilityUnavailableError,
  AiInputError,
  DeterministicFakeMemoryAssistant,
  NullMemoryAssistant,
  type AiCapability,
} from "../../lib/ai";

const TEXT_INPUT = {
  messages: [
    { role: "system" as const, content: "Return a test result." },
    { role: "user" as const, content: "A family-memory fixture." },
  ],
};

describe("NullMemoryAssistant", () => {
  it("advertises no capability and performs no implicit fallback", async () => {
    const assistant = new NullMemoryAssistant();

    for (const capability of [
      "text",
      "vision",
      "transcription",
      "embeddings",
    ] as const) {
      expect(assistant.supports(capability)).toBe(false);
      expect(assistant.capabilities[capability]).toEqual({
        available: false,
        model: null,
        reason: "disabled",
      });
    }
    await expect(assistant.generateText(TEXT_INPUT)).rejects.toMatchObject({
      code: "ai_capability_unavailable",
      capability: "text",
    });
  });
});

describe("DeterministicFakeMemoryAssistant", () => {
  it("returns byte-for-byte repeatable offline results", async () => {
    const first = new DeterministicFakeMemoryAssistant({ seed: "fixture" });
    const second = new DeterministicFakeMemoryAssistant({ seed: "fixture" });

    await expect(first.generateText(TEXT_INPUT)).resolves.toEqual(
      await second.generateText(TEXT_INPUT),
    );
    const imageInput = {
      prompt: "Describe only visible details.",
      image: {
        bytes: new Uint8Array([1, 3, 3, 7]),
        mimeType: "image/jpeg" as const,
      },
    };
    await expect(first.analyzeImage(imageInput)).resolves.toEqual(
      await second.analyzeImage(imageInput),
    );
    const audioInput = {
      audio: {
        bytes: new Uint8Array([8, 6, 7, 5, 3, 0, 9]),
        fileName: "fixture.mp3",
        mimeType: "audio/mpeg" as const,
      },
      language: "zh-CN",
    };
    await expect(first.transcribeAudio(audioInput)).resolves.toEqual(
      await second.transcribeAudio(audioInput),
    );
    await expect(
      first.createEmbeddings({ inputs: ["one", "two"] }),
    ).resolves.toEqual(
      await second.createEmbeddings({ inputs: ["one", "two"] }),
    );
  });

  it("changes deterministic output when the input or seed changes", async () => {
    const one = new DeterministicFakeMemoryAssistant({ seed: "one" });
    const two = new DeterministicFakeMemoryAssistant({ seed: "two" });

    const oneResult = await one.generateText(TEXT_INPUT);
    const twoResult = await two.generateText(TEXT_INPUT);
    const changedInput = await one.generateText({
      messages: [{ role: "user", content: "Different fixture." }],
    });
    expect(oneResult.text).not.toBe(twoResult.text);
    expect(oneResult.text).not.toBe(changedInput.text);

    const changedOptions = await one.generateText({
      ...TEXT_INPUT,
      temperature: 0.5,
    });
    expect(oneResult.text).not.toBe(changedOptions.text);

    const audio = {
      audio: {
        bytes: new Uint8Array([1, 2, 3]),
        fileName: "private-family-name.mp3",
        mimeType: "audio/mpeg" as const,
      },
    };
    const plainTranscript = await one.transcribeAudio(audio);
    const promptedTranscript = await one.transcribeAudio({
      ...audio,
      language: "zh-CN",
      prompt: "Known names",
    });
    expect(plainTranscript.text).not.toBe(promptedTranscript.text);
  });

  it("honors a pre-cancelled signal like the network provider", async () => {
    const assistant = new DeterministicFakeMemoryAssistant();
    const controller = new AbortController();
    controller.abort();

    await expect(
      assistant.generateText({ ...TEXT_INPUT, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "ai_aborted", retryable: false });
  });

  it("produces finite, normalized embeddings with a stable dimension", async () => {
    const assistant = new DeterministicFakeMemoryAssistant({
      embeddingDimensions: 12,
    });
    const result = await assistant.createEmbeddings({
      inputs: ["alpha", "beta"],
    });

    expect(result.dimensions).toBe(12);
    expect(result.vectors).toHaveLength(2);
    for (const vector of result.vectors) {
      expect(vector).toHaveLength(12);
      expect(vector.every(Number.isFinite)).toBe(true);
      const norm = Math.sqrt(
        vector.reduce((sum, component) => sum + component ** 2, 0),
      );
      expect(norm).toBeCloseTo(1, 12);
    }
  });

  it("can independently disable a capability for outage and fallback tests", async () => {
    const disabledCapability: AiCapability = "vision";
    const assistant = new DeterministicFakeMemoryAssistant({
      capabilities: { [disabledCapability]: false },
    });

    expect(assistant.supports("text")).toBe(true);
    expect(assistant.supports("vision")).toBe(false);
    await expect(
      assistant.analyzeImage({
        prompt: "fixture",
        image: {
          bytes: new Uint8Array([1]),
          mimeType: "image/png",
        },
      }),
    ).rejects.toBeInstanceOf(AiCapabilityUnavailableError);
  });

  it("validates fake inputs just like a real provider", async () => {
    const assistant = new DeterministicFakeMemoryAssistant();
    await expect(
      assistant.generateText({ messages: [{ role: "user", content: "   " }] }),
    ).rejects.toBeInstanceOf(AiInputError);
    await expect(
      assistant.createEmbeddings({ inputs: [] }),
    ).rejects.toBeInstanceOf(AiInputError);
  });

  it("returns explicit JSON when that response format is requested", async () => {
    const assistant = new DeterministicFakeMemoryAssistant();
    const result = await assistant.generateText({
      ...TEXT_INPUT,
      responseFormat: "json",
    });

    expect(JSON.parse(result.text)).toEqual({
      fake: true,
      id: expect.stringMatching(/^[0-9a-f]{8}$/u),
    });
  });
});
