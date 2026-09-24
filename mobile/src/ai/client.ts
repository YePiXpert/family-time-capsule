import { SERVICE_URL } from "../local/brand";
import { getToken } from "../family/session";
import { AIError } from "./error";
export { getToken } from "../family/session";
const BASE = SERVICE_URL;
export { AIError } from "./error";
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
/** 二进制录音只在这里上传；RN 原生 XHR 可直接发送 Uint8Array。 */
export async function upload<T>(
  path: string,
  body: Uint8Array,
  contentType: string,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<T> {
  const canceled = () => new AIError("CANCELED", "已停止等待，草稿不变。");
  const network = () => new AIError("NETWORK", "现在连不上服务，请稍后再试。");
  if (signal?.aborted) throw canceled();
  const token = await getToken();
  if (signal?.aborted) throw canceled();
  return new Promise<T>((resolve, reject) => {
    const xhr = new globalThis.XMLHttpRequest();
    let settled = false;
    const done = (action: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", cancel);
      action();
    };
    const cancel = () => {
      done(() => reject(canceled()));
      xhr.abort();
    };
    xhr.onload = () => {
      const ok = xhr.status >= 200 && xhr.status < 300;
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder().decode(
          new Uint8Array((xhr.response as ArrayBuffer | null) ?? new ArrayBuffer(0)),
        ));
      } catch {
        done(() => reject(new AIError(
          ok ? "INVALID_RESULT" : "SERVER_ERROR",
          ok ? "AI 服务返回了无法解析的内容。" : "AI 服务暂时不可用。",
        )));
        return;
      }
      if (!ok) {
        const error = value as { code?: unknown; message?: unknown } | null;
        done(() => reject(new AIError(
          typeof error?.code === "string" ? error.code : "SERVER_ERROR",
          typeof error?.message === "string" ? error.message : "AI 服务暂时不可用。",
        )));
      } else done(() => resolve(value as T));
    };
    xhr.onerror = xhr.ontimeout = () => done(() => reject(network()));
    xhr.onabort = () => done(() => reject(canceled()));
    try {
      xhr.open("POST", BASE + path);
      xhr.responseType = "arraybuffer";
      xhr.timeout = 115000;
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.setRequestHeader("Content-Length", String(body.byteLength));
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
      signal?.addEventListener("abort", cancel);
      if (signal?.aborted) { cancel(); return; }
      xhr.send(body);
    } catch {
      done(() => reject(signal?.aborted ? canceled() : network()));
    }
  });
}
