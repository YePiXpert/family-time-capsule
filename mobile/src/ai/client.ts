import * as SecureStore from "expo-secure-store";
import {
  AI_CONSENT_KEY,
  AI_SESSION_KEY,
  LEGACY_AI_CONSENT_KEY,
  LEGACY_AI_SESSION_KEY,
} from "../local/brand";
const BASE = "https://capsule.yep.li/api/v1";
const SESSION = AI_SESSION_KEY,
  CONSENT = AI_CONSENT_KEY;
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
/** 改名前的键里可能还存着这台设备的凭证；读到就搬到新键上，
 *  否则一次改名就把已经加入 AI 的设备静默踢了出去。搬不动就照旧值用。 */
async function readCarriedOver(key: string, legacy: string) {
  const current = await SecureStore.getItemAsync(key);
  if (current !== null) return current;
  const carried = await SecureStore.getItemAsync(legacy);
  if (carried === null) return null;
  try {
    await SecureStore.setItemAsync(key, carried, options);
    await SecureStore.deleteItemAsync(legacy);
  } catch {
    // 钥匙串写不进去也不该挡住这次调用：这一轮先用旧键的值。
  }
  return carried;
}
export class AIError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
export const getToken = () => readCarriedOver(SESSION, LEGACY_AI_SESSION_KEY);
export const disconnect = async () => {
  await SecureStore.deleteItemAsync(SESSION);
  await SecureStore.deleteItemAsync(LEGACY_AI_SESSION_KEY);
};
export const hasConsent = async () =>
  (await readCarriedOver(CONSENT, LEGACY_AI_CONSENT_KEY)) === "yes";
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
export const serviceStatus = () => api<{ initialized: boolean }>("/status");
async function signIn(path: string, body: Record<string, string>) {
  const result = await api<{ token: string }>(path, body);
  if (typeof result.token !== "string" || result.token.length < 32)
    throw new AIError("INVALID_RESULT", "设备凭证无效。");
  await SecureStore.setItemAsync(SESSION, result.token, options);
}
/** 空库上第一次初始化：这台设备直接成为主人，只允许一次。 */
export const setupService = (
  username: string,
  password: string,
  deviceName: string,
) =>
  signIn("/setup", {
    username: username.trim(),
    password,
    deviceName: deviceName.trim(),
  });
export const login = (
  username: string,
  password: string,
  deviceName: string,
) =>
  signIn("/login", {
    username: username.trim(),
    password,
    deviceName: deviceName.trim(),
  });
export const changePassword = (current: string, next: string) =>
  api(
    "/password",
    { current: current.trim() || undefined, next },
    "PUT",
  );
