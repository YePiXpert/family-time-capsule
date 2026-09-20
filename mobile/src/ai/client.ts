import { SERVICE_URL } from "../local/brand";
import { getToken, saveToken } from "./session";
export {
  disconnect,
  getToken,
  giveConsent,
  hasConsent,
  saveToken,
} from "./session";
const BASE = SERVICE_URL;
export class AIError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
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
    const text = await response.text();
    let value: { code?: unknown; message?: unknown };
    try {
      value = text ? JSON.parse(text) : {};
    } catch {
      // 网关塞来 HTML 错误页或空响应体时，别把解析失败谎报成网络中断。
      throw new AIError(
        response.ok ? "INVALID_RESULT" : "SERVER_ERROR",
        response.ok ? "AI 服务返回了无法解析的内容。" : "AI 服务暂时不可用。",
      );
    }
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
        : "现在连不上服务，请稍后再试。",
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
  await saveToken(result.token);
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
export const login = (username: string, password: string, deviceName: string) =>
  signIn("/login", {
    username: username.trim(),
    password,
    deviceName: deviceName.trim(),
  });
export const changePassword = (current: string, next: string) =>
  api("/password", { current: current || undefined, next }, "PUT");
