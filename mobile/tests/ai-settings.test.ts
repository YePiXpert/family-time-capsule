import { afterEach, expect, it, vi } from "vitest";
import { changeAiConsent, fetchAiSettings, parseAiSettings } from "../src/api/client";

afterEach(() => vi.unstubAllGlobals());
const status = { valid: true, configured: true, configurationId: "fixture-deployment", provider: "Test provider", external: true, canConfigure: true, workerAvailable: false, capabilities: ["text", "vision", "transcription"].map(capability => ({ capability, model: "fixture-model", available: true, consented: false, check: { state: "untested", testedAt: null, code: null } })) };
const credentials = { serverUrl: "https://test.invalid", token: "fixture-session" };

it("requires complete independent capability states and rejects ambiguous results", () => {
  expect(parseAiSettings(status)).toEqual(status);
  expect(() => parseAiSettings({ ...status, capabilities: [status.capabilities[0], status.capabilities[0], status.capabilities[0]] })).toThrow();
  expect(() => parseAiSettings({ ...status, workerAvailable: "yes" })).toThrow();
});

it("submits the reviewed configuration identity using authenticated JSON and distinguishes authorization from offline failure", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(status));
  vi.stubGlobal("fetch", fetch);
  await changeAiConsent(credentials, "text", "enable", "fixture-deployment");
  expect(fetch).toHaveBeenCalledWith("https://test.invalid/api/mobile/v1/ai/settings", expect.objectContaining({ method: "POST", body: JSON.stringify({ capability: "text", operation: "enable", configurationId: "fixture-deployment" }) }));
  for (const code of [401, 403, 404]) {
    fetch.mockResolvedValueOnce(new Response("{}", { status: code }));
    await expect(fetchAiSettings(credentials)).rejects.toMatchObject({ status: code });
  }
  fetch.mockRejectedValueOnce(new Error("offline"));
  await expect(fetchAiSettings(credentials)).rejects.toMatchObject({ status: 0 });
});
