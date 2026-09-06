import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { aiConfigurationFingerprint, aiConfigurationStatus, readAiCapabilityChecks, testAiCapability } from "@/lib/ai/diagnostics";
import type { MemoryAssistant } from "@/lib/ai/types";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const env = { AI_PROVIDER: "openai-compatible", AI_BASE_URL: "https://fixture.invalid/v1", AI_API_KEY: "test-private-value", AI_MODEL: "fixture" };

it("reads only current bounded capability records and never treats missing or invalid records as passed", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ftc-diagnostics-"));
  directories.push(directory);
  const environment = { ...env, DATA_DIR: directory, AI_CONFIGURATION_ID: "test-installation-a" };
  mkdirSync(path.join(directory, "ai-diagnostics"));
  const file = path.join(directory, "ai-diagnostics/text.json");
  expect(readAiCapabilityChecks(environment).text.state).toBe("untested");
  writeFileSync(file, JSON.stringify({ capability: "text", passed: true, testedAt: "2026-09-06T10:00:00Z", configuration: aiConfigurationFingerprint(environment) }));
  expect(readAiCapabilityChecks(environment).text.state).toBe("passed");
  expect(readAiCapabilityChecks({ ...environment, AI_CONFIGURATION_ID: "test-installation-b" }).text.state).toBe("untested");
  expect(readAiCapabilityChecks({ ...environment, AI_BASE_URL: "https://different.invalid/v1" }).text.state).toBe("untested");
  writeFileSync(file, "invalid json");
  expect(readAiCapabilityChecks(environment).text.state).toBe("untested");
  writeFileSync(file, "x".repeat(9000));
  expect(readAiCapabilityChecks(environment).text.state).toBe("untested");
});

it("does not expose a key or key hash in operational configuration", () => {
  expect(JSON.stringify(aiConfigurationStatus(env))).not.toContain(env.AI_API_KEY);
  expect(aiConfigurationFingerprint(env)).toBe(aiConfigurationFingerprint({ ...env, AI_API_KEY: "rotated-secret" }));
});

it("rejects successful transports whose semantic text, image or speech result is wrong", async () => {
  const assistant = {
    supports: () => true,
    generateText: async () => ({ text: '{"answer":41}' }),
    analyzeImage: async () => ({ text: '{"shape":"square","color":"blue"}' }),
    transcribeAudio: async () => ({ text: "", segments: [] }),
  } as unknown as MemoryAssistant;
  for (const capability of ["text", "vision", "transcription"] as const) {
    await expect(testAiCapability(assistant, capability, new Uint8Array())).rejects.toThrow(/semantic_test_failed/u);
  }
});
