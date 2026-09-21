import { expect, it, vi } from "vitest";
import { appendTranscript } from "../src/local/transcribe";
import { runTranscription, type TranscriptionDeps, type TranscriptionState } from "../src/local/transcribeRun";

function fixture(overrides: Partial<TranscriptionDeps> = {}) {
  let text = "原来的正文";
  const settings = { transcribeConsent: false };
  const states: TranscriptionState[] = [];
  const controller = new AbortController();
  const deps: TranscriptionDeps = {
    availability: async () => "on-device",
    signedIn: async () => true,
    consent: () => settings.transcribeConsent,
    askConsent: vi.fn(async () => "cancel" as const),
    rememberConsent: vi.fn(async () => { settings.transcribeConsent = true; }),
    onDevice: vi.fn(async () => "她笑了"),
    onServer: vi.fn(async () => "她笑了"),
    onTranscript: vi.fn((words) => { text = appendTranscript(text, words); }),
    onState: (state) => states.push(state),
    platform: "android",
    ...overrides,
  };
  return { deps, states, settings, controller, text: () => text,
    type: (next: string) => { text = next; },
    run: () => runTranscription(deps, controller.signal) };
}
it("appends on-device words without asking server consent or uploading", async () => {
  const f = fixture(); await f.run();
  expect(f.text()).toBe("原来的正文\n\n她笑了");
  expect(f.deps.onServer).not.toHaveBeenCalled();
  expect(f.deps.askConsent).not.toHaveBeenCalled();
  expect(f.states.at(-1)).toEqual({ status: "idle", message: "" });
});
it("canceling consent does not upload or remember anything", async () => {
  const f = fixture({ availability: async () => "unavailable" }); await f.run();
  expect(f.deps.onServer).not.toHaveBeenCalled();
  expect(f.deps.rememberConsent).not.toHaveBeenCalled();
  expect(f.text()).toBe("原来的正文");
  expect(f.states.at(-1)).toEqual({ status: "idle", message: "" });
});
it.each(["once", "always"] as const)("honors %s consent", async (choice) => {
  const f = fixture({ availability: async () => "unavailable", askConsent: async () => choice });
  await f.run();
  expect(f.deps.onServer).toHaveBeenCalledOnce();
  expect(f.settings.transcribeConsent).toBe(choice === "always");
  expect(f.deps.rememberConsent).toHaveBeenCalledTimes(choice === "always" ? 1 : 0);
});
it("remembered consent skips the question", async () => {
  const f = fixture({ availability: async () => "unavailable", consent: () => true }); await f.run();
  expect(f.deps.askConsent).not.toHaveBeenCalled();
  expect(f.deps.onServer).toHaveBeenCalledOnce();
});
function deferred() {
  let resolve!: (text: string) => void;
  const promise = new Promise<string>((done) => { resolve = done; });
  return { promise, resolve };
}
it("ignores a late result and state updates after stop", async () => {
  const pending = deferred();
  const f = fixture({ onDevice: () => pending.promise }); const job = f.run();
  await Promise.resolve(); await Promise.resolve();
  f.controller.abort(); const count = f.states.length;
  pending.resolve("晚来的结果"); await job;
  expect(f.text()).toBe("原来的正文");
  expect(f.states).toHaveLength(count);
  expect(f.deps.onTranscript).not.toHaveBeenCalled();
});
it("appends to the words typed during recognition", async () => {
  const pending = deferred();
  const f = fixture({ onDevice: () => pending.promise }); const job = f.run();
  f.type("等待期间补的正文"); pending.resolve("她笑了"); await job;
  expect(f.text()).toBe("等待期间补的正文\n\n她笑了");
});
it("empty recognition keeps text and explains that audio is saved", async () => {
  const f = fixture({ onDevice: async () => " \n" }); await f.run();
  expect(f.deps.onTranscript).not.toHaveBeenCalled();
  expect(f.states.at(-1)).toEqual({ status: "failed", message: "没听清，录音已保存。" });
});
it("ignores consent chosen after cancellation", async () => {
  let answer!: (choice: "always") => void;
  const f = fixture({ availability: async () => "unavailable", askConsent: () => new Promise((resolve) => { answer = resolve; }) });
  const job = f.run(); await Promise.resolve(); await Promise.resolve();
  f.controller.abort(); answer("always"); await job;
  expect(f.deps.rememberConsent).not.toHaveBeenCalled();
  expect(f.deps.onServer).not.toHaveBeenCalled();
});
it.each([
  ["DENIED", "ignored", "没有语音识别权限，可在系统设置里开启；录音已保存。"],
  ["BUSY", "请稍后再试", "请稍后再试"],
  ["CANCELED", "ignored", ""],
])("handles %s without changing words", async (code, message, expected) => {
  const f = fixture({ onDevice: async () => { throw { code, message }; } }); await f.run();
  expect(f.text()).toBe("原来的正文");
  expect(f.states.at(-1)?.message).toBe(expected);
});
it("unavailable without login gives a hint without uploading", async () => {
  const f = fixture({ availability: async () => "unavailable", signedIn: async () => false }); await f.run();
  expect(f.states.at(-1)?.message).toContain("登录家人账号");
  expect(f.deps.onServer).not.toHaveBeenCalled();
});
