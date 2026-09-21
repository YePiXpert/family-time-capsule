import { requireOptionalNativeModule } from "expo-modules-core";

export type SpeechAvailability = "on-device" | "unavailable";
export type SpeechErrorCode = "UNAVAILABLE" | "DENIED" | "CANCELED" | "FAILED";
export class SpeechError extends Error {
  constructor(public code: SpeechErrorCode, message: string) {
    super(message);
    this.name = "SpeechError";
  }
}
type NativeModule = {
  availabilityAsync(locale: string): Promise<SpeechAvailability>;
  transcribeFileAsync(uri: string, locale: string): Promise<string>;
  cancelAsync(): Promise<void>;
};
const native = requireOptionalNativeModule<NativeModule>("FamilySpeechRecognition");
const messages: Record<SpeechErrorCode, string> = {
  UNAVAILABLE: "这台手机暂时无法本机转文字，录音已保存。",
  DENIED: "没有语音识别权限，可在系统设置里开启；录音已保存。",
  CANCELED: "已停止转文字，录音已保存。",
  FAILED: "这次没能转成文字，录音已保存。",
};
export async function speechAvailability(locale = "zh-CN"): Promise<SpeechAvailability> {
  if (!native) return "unavailable";
  return native.availabilityAsync(locale);
}
let active: symbol | undefined;
export function transcribeFile(
  uri: string,
  opts: { locale?: string; signal?: AbortSignal },
): Promise<string> {
  const { signal } = opts;
  if (signal?.aborted)
    return Promise.reject(new SpeechError("CANCELED", messages.CANCELED));
  if (!native)
    return Promise.reject(new SpeechError("UNAVAILABLE", messages.UNAVAILABLE));
  const module = native;
  const id = Symbol();
  active = id;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener("abort", cancel);
      if (active === id) active = undefined;
    };
    const cancel = () => {
      if (active === id) void module.cancelAsync().catch(() => {});
      cleanup();
      reject(new SpeechError("CANCELED", messages.CANCELED));
    };
    signal?.addEventListener("abort", cancel);
    module.transcribeFileAsync(uri, opts.locale ?? "zh-CN").then(
      (text) => { cleanup(); resolve(text); },
      (error: unknown) => {
        cleanup();
        const raw = error as { code?: string; message?: string } | null;
        const code = (["UNAVAILABLE", "DENIED", "CANCELED", "FAILED"] as const)
          .find((code) => raw?.code === code || raw?.code === `ERR_${code}` || raw?.message === code) ?? "FAILED";
        const message = typeof raw?.message === "string" && raw.message !== code
          && raw?.code === code ? raw.message : messages[code];
        reject(new SpeechError(code, message));
      },
    );
  });
}
