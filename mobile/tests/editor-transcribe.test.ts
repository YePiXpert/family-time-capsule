import { expect, it, vi } from "vitest";
import { appendTranscript } from "../src/local/transcribe";
import { runTranscription, type TranscriptionDeps, type TranscriptionState } from "../src/local/transcribeRun";

function fixture(overrides: Partial<TranscriptionDeps> = {}) {
  let text = "原来的正文";
  const states: TranscriptionState[] = [];
  const controller = new AbortController();
  const deps: TranscriptionDeps = {
    availability: async () => "on-device",
    signedIn: async () => true,
    onDevice: vi.fn(async () => "她笑了"),
    onServer: vi.fn(async () => "她笑了"),
    onTranscript: vi.fn((words) => { text = appendTranscript(text, words); }),
    onState: (state) => states.push(state),
    platform: "android",
    ...overrides,
  };
  return { deps, states, controller, text: () => text,
    type: (next: string) => { text = next; },
    run: () => runTranscription(deps, controller.signal) };
}
it("appends on-device words without uploading", async () => {
  const f = fixture(); await f.run();
  expect(f.text()).toBe("原来的正文\n\n她笑了");
  expect(f.deps.onServer).not.toHaveBeenCalled();
  expect(f.states.at(-1)).toEqual({ status: "idle", message: "" });
});
it("without on-device recognition a joined phone transcribes on the server straight away", async () => {
  const f = fixture({ availability: async () => "unavailable" }); await f.run();
  expect(f.deps.onServer).toHaveBeenCalledOnce();
  expect(f.text()).toBe("原来的正文\n\n她笑了");
  expect(f.states.at(-1)).toEqual({ status: "idle", message: "" });
});
it("a phone that has not joined explains how to get transcription and uploads nothing", async () => {
  const f = fixture({ availability: async () => "unavailable", signedIn: async () => false }); await f.run();
  expect(f.deps.onServer).not.toHaveBeenCalled();
  expect(f.text()).toBe("原来的正文");
  expect(f.states.at(-1)?.status).toBe("failed");
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
it("stopping before the server route starts uploads nothing", async () => {
  let signIn!: (yes: boolean) => void;
  const f = fixture({ availability: async () => "unavailable", signedIn: () => new Promise((resolve) => { signIn = resolve; }) });
  const job = f.run(); await Promise.resolve(); await Promise.resolve();
  f.controller.abort(); signIn(true); await job;
  expect(f.deps.onServer).not.toHaveBeenCalled();
  expect(f.text()).toBe("原来的正文");
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
  expect(f.states.at(-1)?.message).toContain("加入家庭");
  expect(f.deps.onServer).not.toHaveBeenCalled();
});
