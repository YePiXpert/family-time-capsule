import { expect, it } from "vitest";
import { captureOrganizerAvailability, captureSavedMessage, captureDateSummary } from "../src/drafts/capture";
import type { AiSettings } from "../src/ai/types";
const settings: AiSettings = { valid: true, configured: true, configurationId: "fixture", provider: "fixture", external: true, canConfigure: true, workerAvailable: true, capabilities: (["text", "vision", "transcription"] as const).map(capability => ({ capability, model: "fixture", available: true, consented: true, check: { state: "untested", testedAt: null, code: null } })) };
it("offers combined save only for the actual media capabilities and current consent", () => {
  expect(captureOrganizerAvailability(settings, "family", ["image/jpeg", "audio/wav"]).ready).toBe(true);
  const partial = { ...settings, capabilities: settings.capabilities.map(row => row.capability === "vision" ? { ...row, consented: false } : row) };
  expect(captureOrganizerAvailability(partial, "family", ["image/jpeg"]).ready).toBe(false);
  expect(captureOrganizerAvailability(partial, "family", ["audio/wav"]).ready).toBe(true);
  expect(captureOrganizerAvailability(null, "family", []).ready).toBe(false);
  expect(captureOrganizerAvailability(settings, "family", [""]).ready).toBe(false);
});
it("does not offer background organization for private audiences or silently truncate a batch", () => {
  for (const visibility of ["private", "members"] as const) expect(captureOrganizerAvailability(settings, visibility, ["image/jpeg"]).ready).toBe(false);
  expect(captureOrganizerAvailability(settings, "family", Array(11).fill("image/jpeg")).ready).toBe(false);
});
it("distinguishes a saved memory from a failed AI request", () => {
  expect(captureSavedMessage({ state: "queued", jobId: "job" })).toContain("已保存");
  expect(captureSavedMessage({ state: "skipped", reason: "capability_not_consented" })).toContain("记忆和原件已保存，AI 暂未开始");
  expect(captureSavedMessage({ state: "skipped", reason: "not_requested" })).not.toContain("正在");
});

it("never displays today as a missing manual date", () => {
  expect(captureDateSummary({ occurredAt: null, occurredAtPrecision: "exact" }, true, "UTC")).toBe("尚未填完日期，也可以选择时间不确定。");
  expect(captureDateSummary({ occurredAt: null, occurredAtPrecision: "exact" }, false, "UTC")).toContain("自动读取");
  expect(captureDateSummary({ occurredAt: null, occurredAtPrecision: "unknown" }, true, "UTC")).toContain("时间不确定");
});


it("keeps manual consent separate from automatic organization", () => {
  expect(captureOrganizerAvailability(settings, "family", [], "automatic").ready).toBe(false);
  const automatic = { ...settings, capabilities: settings.capabilities.map(row => ({ ...row, automaticAllowed: true })) };
  expect(captureOrganizerAvailability(automatic, "family", ["image/jpeg"], "automatic").ready).toBe(true);
  expect(captureOrganizerAvailability(automatic, "private", [], "automatic").ready).toBe(false);
});
