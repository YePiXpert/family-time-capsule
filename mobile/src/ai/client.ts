import * as SecureStore from "expo-secure-store";
const BASE = "https://capsule.yep.li/api/v1";
const SESSION = "xiaomei-ai-device-v1",
  CONSENT = "xiaomei-ai-consent-v1";
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export class AIError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
export const getToken = () => SecureStore.getItemAsync(SESSION);
export const disconnect = () => SecureStore.deleteItemAsync(SESSION);
export const hasConsent = async () =>
  (await SecureStore.getItemAsync(CONSENT)) === "yes";
export const giveConsent = () =>
  SecureStore.setItemAsync(CONSENT, "yes", options);
export async function api<T>(
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
  signal?: AbortSignal,
): Promise<T> {
  const token = await getToken();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel);
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(cancel, 115000);
  try {
    const response = await fetch(BASE + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const value = await response.json();
    if (!response.ok)
      throw new AIError(
        typeof value.code === "string" ? value.code : "SERVER_ERROR",
        typeof value.message === "string"
          ? value.message
          : "AI 服务暂时不可用。",
      );
    return value as T;
  } catch (e) {
    if (e instanceof AIError) throw e;
    throw new AIError(
      signal?.aborted ? "CANCELED" : "NETWORK",
      signal?.aborted
        ? "已停止等待，草稿不变。"
        : "网络中断或等待超时。重试会沿用原请求，避免重复提交。",
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
export async function enroll(code: string, deviceName: string) {
  const result = await api<{ token: string }>("/enroll", {
    code: code.trim(),
    deviceName: deviceName.trim(),
  });
  if (typeof result.token !== "string" || result.token.length < 32)
    throw new AIError("INVALID_RESULT", "设备凭证无效。");
  await SecureStore.setItemAsync(SESSION, result.token, options);
}
