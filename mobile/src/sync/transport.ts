import { SERVICE_URL } from "../local/brand";
import { getToken } from "../ai/session";
/**
 * 远端备份唯一的联网文件（宪法白名单里的第二个）。用 XMLHttpRequest 而不是 fetch：
 * RN 的 XHR 原生支持二进制请求体与 arraybuffer 响应，fetch().arrayBuffer() 在 RN 上并不稳。
 * HttpClient 可注入：真机用 xhrClient，vitest 端到端用 Node fetch。
 */
export type HttpRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Uint8Array | string;
  timeoutMs: number;
  signal?: AbortSignal;
};
export type HttpResponse = { status: number; body: Uint8Array };
export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;
export class SyncError extends Error {
  code: string;
  status: number | null;
  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.name = "SyncError";
    this.code = code;
    this.status = status;
  }
}
export const TIMEOUT_MS = 115000;
const NETWORK_MESSAGE = "现在连不上服务，请稍后再试。";
export const xhrClient: HttpClient = (request) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(request.method, request.url);
    xhr.responseType = "arraybuffer";
    xhr.timeout = request.timeoutMs;
    for (const [name, value] of Object.entries(request.headers))
      xhr.setRequestHeader(name, value);
    const cancel = () => xhr.abort();
    request.signal?.addEventListener("abort", cancel);
    const done = (fn: () => void) => {
      request.signal?.removeEventListener("abort", cancel);
      fn();
    };
    xhr.onload = () =>
      done(() =>
        resolve({
          status: xhr.status,
          body: new Uint8Array(
            (xhr.response as ArrayBuffer | null) ?? new ArrayBuffer(0),
          ),
        }),
      );
    xhr.onerror = () =>
      done(() => reject(new SyncError("NETWORK", NETWORK_MESSAGE)));
    xhr.ontimeout = () =>
      done(() =>
        reject(new SyncError("TIMEOUT", "服务响应超时，请稍后再试。")),
      );
    xhr.onabort = () =>
      done(() => reject(new SyncError("CANCELED", "已停止。")));
    if (request.signal?.aborted) {
      done(() => reject(new SyncError("CANCELED", "已停止。")));
      return;
    }
    const body = request.body;
    xhr.send(
      body instanceof Uint8Array
        ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
        : body,
    );
  });
export type RemoteStatus = {
  keyId: string | null;
  manifestUpdatedAt: string | null;
  objects: number;
  bytes: number;
  limitBytes: number;
  freeBytes: number;
};
export type RemoteManifest = {
  keyId: string;
  index: string;
  updatedAt: string;
};
export type Transport = {
  status(signal?: AbortSignal): Promise<RemoteStatus>;
  /** 返回远端还没有的 id。 */
  missing(ids: readonly string[], signal?: AbortSignal): Promise<Set<string>>;
  put(
    id: string,
    bytes: Uint8Array,
    sha256: string,
    signal?: AbortSignal,
  ): Promise<{ created: boolean }>;
  get(id: string, signal?: AbortSignal): Promise<Uint8Array>;
  putManifest(
    keyId: string,
    index: string,
    signal?: AbortSignal,
  ): Promise<string>;
  /** 远端还没有清单时返回 null。 */
  getManifest(signal?: AbortSignal): Promise<RemoteManifest | null>;
  prune(
    keep: readonly string[],
    signal?: AbortSignal,
  ): Promise<{ removed: number; bytes: number }>;
  wipe(signal?: AbortSignal): Promise<void>;
};
const HAVE_BATCH = 2000;
const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "请先在「AI 设置」里登录家人账号。",
  QUOTA_FULL: "远端备份空间已用完，请联系主人调整。",
  TOO_LARGE: "这一份太大，请更新应用后重试。",
  SERVER_FULL: "服务器空间不足，请联系主人。",
  BUSY: "正在上传其他内容，请稍后再试。",
  NOT_FOUND: "远端没有这一份。",
};
function decodeJson(body: Uint8Array): Record<string, unknown> | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    const value: unknown = text ? JSON.parse(text) : {};
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
export function createTransport(
  http: HttpClient = xhrClient,
  base: string = SERVICE_URL,
  token: () => Promise<string | null> = getToken,
): Transport {
  const call = async (
    method: string,
    path: string,
    options: {
      body?: Uint8Array | string;
      headers?: Record<string, string>;
      signal?: AbortSignal;
      binary?: boolean;
      allow404?: boolean;
    } = {},
  ): Promise<{
    status: number;
    json: Record<string, unknown>;
    body: Uint8Array;
  }> => {
    const bearer = await token();
    if (!bearer)
      throw new SyncError("AUTH_REQUIRED", MESSAGES.AUTH_REQUIRED!, 401);
    let response: HttpResponse;
    try {
      response = await http({
        method,
        url: base + path,
        headers: {
          Authorization: `Bearer ${bearer}`,
          Accept: "application/json, application/octet-stream",
          ...(typeof options.body === "string"
            ? { "Content-Type": "application/json" }
            : {}),
          ...(options.headers ?? {}),
        },
        body: options.body,
        timeoutMs: TIMEOUT_MS,
        signal: options.signal,
      });
    } catch (e) {
      if (e instanceof SyncError) throw e;
      throw new SyncError(
        options.signal?.aborted ? "CANCELED" : "NETWORK",
        options.signal?.aborted ? "已停止。" : NETWORK_MESSAGE,
      );
    }
    if (response.status >= 200 && response.status < 300) {
      if (options.binary)
        return { status: response.status, json: {}, body: response.body };
      const json = decodeJson(response.body);
      if (!json)
        throw new SyncError(
          "SERVER_ERROR",
          "服务返回了无法解析的内容。",
          response.status,
        );
      return { status: response.status, json, body: response.body };
    }
    const json = decodeJson(response.body);
    if (response.status === 404 && options.allow404)
      return { status: 404, json: json ?? {}, body: response.body };
    // 网关的 HTML 错误页没有我们的 code：按状态码给一句能懂的话，别把 HTML 甩给用户。
    const code =
      typeof json?.code === "string"
        ? json.code
        : response.status === 401
          ? "AUTH_REQUIRED"
          : response.status === 413
            ? "TOO_LARGE"
            : response.status === 507
              ? "SERVER_FULL"
              : response.status === 429
                ? "BUSY"
                : "SERVER_ERROR";
    const message =
      typeof json?.message === "string"
        ? json.message
        : (MESSAGES[code] ?? "服务暂时不可用，请稍后再试。");
    throw new SyncError(code, message, response.status);
  };
  return {
    async status(signal) {
      const { json } = await call("GET", "/backup/status", { signal });
      return json as RemoteStatus;
    },
    async missing(ids, signal) {
      const missing = new Set<string>();
      for (let at = 0; at < ids.length; at += HAVE_BATCH) {
        const { json } = await call("POST", "/backup/objects/have", {
          body: JSON.stringify({ ids: ids.slice(at, at + HAVE_BATCH) }),
          signal,
        });
        for (const id of (json.missing as string[]) ?? []) missing.add(id);
      }
      return missing;
    },
    async put(id, bytes, sha256, signal) {
      const { status } = await call("PUT", `/backup/objects/${id}`, {
        body: bytes,
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Object-Sha256": sha256,
        },
        signal,
      });
      return { created: status === 201 };
    },
    async get(id, signal) {
      const { body } = await call("GET", `/backup/objects/${id}`, {
        signal,
        binary: true,
      });
      return body;
    },
    async putManifest(keyId, index, signal) {
      const { json } = await call("PUT", "/backup/manifest", {
        body: JSON.stringify({ keyId, index }),
        signal,
      });
      return String(json.updatedAt ?? "");
    },
    async getManifest(signal) {
      const { status, json } = await call("GET", "/backup/manifest", {
        signal,
        allow404: true,
      });
      if (status === 404) return null;
      if (
        typeof json.keyId !== "string" ||
        typeof json.index !== "string" ||
        typeof json.updatedAt !== "string"
      )
        throw new SyncError(
          "SERVER_ERROR",
          "服务返回了无法解析的内容。",
          status,
        );
      return json as RemoteManifest;
    },
    async prune(keep, signal) {
      const { json } = await call("POST", "/backup/prune", {
        body: JSON.stringify({ keep }),
        signal,
      });
      return {
        removed: Number(json.removed ?? 0),
        bytes: Number(json.bytes ?? 0),
      };
    },
    async wipe(signal) {
      await call("DELETE", "/backup", { signal });
    },
  };
}
