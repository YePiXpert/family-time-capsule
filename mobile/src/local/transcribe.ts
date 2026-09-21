import type { SpeechAvailability } from "../../modules/speech-recognition/src";

export type TranscribeRoute = "on-device" | "server-consent" | "server" | "none";
export const TRANSCRIBE_MAX_SECONDS = 180;
export const TRANSCRIBE_MAX_BYTES = 5 * 1024 * 1024;
export function chooseRoute(input: {
  availability: SpeechAvailability;
  signedIn: boolean;
  consent: boolean;
}): TranscribeRoute {
  if (input.availability === "on-device") return "on-device";
  if (!input.signedIn) return "none";
  return input.consent ? "server" : "server-consent";
}
export function appendTranscript(text: string, transcript: string): string {
  const words = transcript.trim();
  if (!words) return text;
  return text.trim() ? `${text.trimEnd()}\n\n${words}` : words;
}
export function serverPrecheck(input: { bytes?: number; seconds?: number }): string | null {
  return (input.bytes ?? 0) > TRANSCRIBE_MAX_BYTES || (input.seconds ?? 0) > TRANSCRIBE_MAX_SECONDS
    ? "这段太长了，转文字最多 3 分钟；录音已保存。"
    : null;
}
export function transcribeHint(route: TranscribeRoute, platform: "ios" | "android"): string {
  if (route !== "none") return "";
  return "这台手机没有中文本机识别；登录家人账号后可以经主人的服务转文字。" +
    (platform === "ios" ? "iPhone 在系统设置里开启中文听写后可本机识别。" : "");
}
