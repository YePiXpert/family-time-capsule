import type {
  Credentials,
  Person,
  SyncPage,
  TimelineEvent,
  Viewer,
} from "../types";

type SignInResponse = {
  token?: unknown;
  user?: { id?: unknown; name?: unknown };
  message?: unknown;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const API_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown, max = 5000): value is string {
  return typeof value === "string" && value.length <= max;
}

function isNullableString(value: unknown, max = 5000): value is string | null {
  return value === null || isString(value, max);
}

function isDateTime(value: unknown): value is string {
  return isString(value, 64) && !Number.isNaN(Date.parse(value));
}

function isViewer(value: unknown): value is Viewer {
  if (!isRecord(value)) return false;
  return (
    isString(value.id, 128) &&
    isString(value.name, 200) &&
    ["admin", "editor", "contributor", "viewer"].includes(
      String(value.role),
    ) &&
    typeof value.canCapture === "boolean" &&
    typeof value.canEditEvents === "boolean"
  );
}

function isPerson(value: unknown): value is Person {
  if (!isRecord(value)) return false;
  return (
    isString(value.id, 128) &&
    isString(value.displayName, 200) &&
    isNullableString(value.relationToChild, 100) &&
    typeof value.isChild === "boolean" &&
    (value.birthDate === null ||
      (isString(value.birthDate, 10) && /^\d{4}-\d{2}-\d{2}$/u.test(value.birthDate))) &&
    isDateTime(value.updatedAt)
  );
}

function isTimelineEvent(value: unknown): value is TimelineEvent {
  if (!isRecord(value)) return false;
  const cover = value.cover;
  const validCover =
    cover === null ||
    (isRecord(cover) &&
      isString(cover.assetId, 128) &&
      isString(cover.mediaAssetId, 128) &&
      isNullableString(cover.type, 32) &&
      isNullableString(cover.mimeType, 200) &&
      isString(cover.path, 512) &&
      cover.path.startsWith("/api/media/"));
  return (
    isString(value.id, 128) &&
    isString(value.title, 500) &&
    isDateTime(value.occurredAt) &&
    isString(value.occurredAtPrecision, 32) &&
    isNullableString(value.locationText, 500) &&
    isString(value.childPersonId, 128) &&
    (value.ageDays === null || Number.isSafeInteger(value.ageDays)) &&
    isDateTime(value.updatedAt) &&
    Number.isSafeInteger(value.assetCount) &&
    Number(value.assetCount) >= 0 &&
    Array.isArray(value.participantNames) &&
    value.participantNames.length <= 1000 &&
    value.participantNames.every((name) => isString(name, 200)) &&
    validCover
  );
}

export function parseSyncPage(value: unknown): SyncPage {
  if (
    !isRecord(value) ||
    value.apiVersion !== 1 ||
    !isDateTime(value.serverTime) ||
    !isViewer(value.viewer) ||
    !isRecord(value.family) ||
    !isString(value.family.id, 128) ||
    !isString(value.family.name, 500) ||
    !isString(value.family.timezone, 100) ||
    !Array.isArray(value.people) ||
    value.people.length > 10_000 ||
    !value.people.every(isPerson) ||
    !Array.isArray(value.events) ||
    value.events.length > 50 ||
    !value.events.every(isTimelineEvent) ||
    !(
      value.nextCursor === null ||
      (isString(value.nextCursor, 512) && value.nextCursor.length > 0)
    )
  ) {
    throw new ApiError("服务器移动 API 返回了无效数据。", 502);
  }
  return value as SyncPage;
}

export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim();
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(trimmed) && !/^https?:\/\//iu.test(trimmed)) {
    throw new Error("服务器地址必须使用 HTTP 或 HTTPS。");
  }
  const withScheme = /^https?:\/\//iu.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (!(["http:", "https:"] as string[]).includes(url.protocol)) {
    throw new Error("服务器地址必须使用 HTTP 或 HTTPS。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("服务器地址不能包含账号、查询参数或片段。");
  }
  return url.toString().replace(/\/$/u, "");
}

export async function signIn(
  serverValue: string,
  email: string,
  password: string,
): Promise<Credentials> {
  const serverUrl = normalizeServerUrl(serverValue);
  let response: Response;
  try {
    response = await fetchWithTimeout(`${serverUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin: new URL(serverUrl).origin,
      },
      body: JSON.stringify({ email: email.trim(), password, rememberMe: true }),
    });
  } catch {
    throw new ApiError("无法连接家庭服务器，请检查地址和网络。", 0);
  }
  let body: SignInResponse = {};
  try {
    body = (await response.json()) as SignInResponse;
  } catch {
    // Keep the stable status-based error below for reverse-proxy HTML errors.
  }
  const tokenHeader = response.headers.get("set-auth-token");
  const tokenBody = typeof body.token === "string" ? body.token : null;
  const token = tokenHeader ?? tokenBody;
  if (!response.ok || !token) {
    throw new ApiError(
      response.status === 401 || response.status === 403
        ? "邮箱或密码不正确。"
        : "无法登录家庭服务器，请检查地址和网络。",
      response.status,
    );
  }
  return { serverUrl, token };
}

export async function signOut(credentials: Credentials): Promise<void> {
  try {
    await fetchWithTimeout(`${credentials.serverUrl}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credentials.token}`,
        origin: new URL(credentials.serverUrl).origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
  } catch {
    // Local sign-out must remain available while the server is offline.
  }
}

export async function fetchSyncPage(
  credentials: Credentials,
  cursor: string | null,
): Promise<SyncPage> {
  const url = new URL(`${credentials.serverUrl}/api/mobile/v1/sync`);
  url.searchParams.set("limit", "50");
  if (cursor) url.searchParams.set("cursor", cursor);
  let response: Response;
  try {
    response = await fetchWithTimeout(url.toString(), {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${credentials.token}`,
      },
    });
  } catch {
    throw new ApiError("无法连接家庭服务器，本地数据不受影响。", 0);
  }
  if (!response.ok) {
    throw new ApiError(
      response.status === 401 ? "登录已过期，请重新登录。" : "同步失败，请稍后重试。",
      response.status,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError("服务器移动 API 返回了无效数据。", 502);
  }
  return parseSyncPage(body);
}

export async function uploadTextCapture(
  credentials: Credentials,
  id: string,
  text: string,
): Promise<void> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${credentials.serverUrl}/api/mobile/v1/captures/text`,
      {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${credentials.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ id, text }),
      },
    );
  } catch {
    throw new ApiError("无法连接家庭服务器，文字仍保留在本机。", 0);
  }
  if (!response.ok) {
    throw new ApiError(
      response.status === 401 ? "登录已过期，请重新登录。" : "文字记忆上传失败。",
      response.status,
    );
  }
}
