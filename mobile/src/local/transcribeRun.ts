import type { SpeechAvailability } from "../../modules/speech-recognition/src";
import { chooseRoute, transcribeHint } from "./transcribe";

export type TranscriptionState = {
  status: "idle" | "working" | "failed";
  message: string;
};
export type TranscriptionConsent = "cancel" | "once" | "always";
export type TranscriptionDeps = {
  availability: () => Promise<SpeechAvailability>;
  signedIn: () => Promise<boolean>;
  consent: () => boolean;
  askConsent: (signal: AbortSignal) => Promise<TranscriptionConsent>;
  rememberConsent: () => Promise<unknown>;
  onDevice: (signal: AbortSignal) => Promise<string>;
  onServer: (signal: AbortSignal) => Promise<string>;
  onTranscript: (text: string) => void | Promise<void>;
  onState: (state: TranscriptionState) => void;
  platform: "ios" | "android";
};
/** 注入平台能力与持久化；每个异步边界都检查取消，旧任务永远不写新草稿。 */
export async function runTranscription(deps: TranscriptionDeps, signal: AbortSignal): Promise<void> {
  const state = (status: TranscriptionState["status"], message = "") => {
    if (!signal.aborted) deps.onState({ status, message });
  };
  if (signal.aborted) return;
  state("working");
  try {
    const availability = await deps.availability();
    if (signal.aborted) return;
    const signedIn = await deps.signedIn();
    if (signal.aborted) return;
    const route = chooseRoute({ availability, signedIn, consent: deps.consent() });
    if (route === "none") {
      state("failed", transcribeHint(route, deps.platform));
      return;
    }
    if (route === "server-consent") {
      const choice = await deps.askConsent(signal);
      if (signal.aborted) return;
      if (choice === "cancel") { state("idle"); return; }
      if (choice === "always") await deps.rememberConsent();
      if (signal.aborted) return;
    }
    const text = await (route === "on-device" ? deps.onDevice(signal) : deps.onServer(signal));
    if (signal.aborted) return;
    if (!text.trim()) { state("failed", "没听清，录音已保存。"); return; }
    await deps.onTranscript(text);
    state("idle");
  } catch (error) {
    const failure = error as { code?: string; message?: string } | null;
    if (failure?.code === "CANCELED") { state("idle"); return; }
    state("failed", failure?.code === "DENIED"
      ? "没有语音识别权限，可在系统设置里开启；录音已保存。"
      : (failure?.code && failure.message) || "这次没能转成文字，录音已保存。");
  }
}
