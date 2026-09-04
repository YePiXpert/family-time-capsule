import type {
  Credentials,
  InboxDraftPatch,
  MobileHome,
  MobileContributionInput,
  MobileInboxAsset,
  MobileInboxEntry,
  MobileInboxPage,
  MobileMemory,
  MobileMemoryAsset,
  MobileSearchPage,
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

function isWallDateTime(value: unknown): value is string {
  return isString(value, 19) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/u.test(value);
}

function isPath(value: unknown): value is string {
  return isString(value, 512) && value.startsWith("/api/");
}

function isNullablePath(value: unknown): value is string | null {
  return value === null || isPath(value);
}

function hasCursor(
  value: unknown,
): value is Record<string, unknown> & { nextCursor: string | null } {
  return (
    isRecord(value) &&
    (value.nextCursor === null || isString(value.nextCursor, 1024))
  );
}

function isViewer(value: unknown): value is Viewer {
  if (!isRecord(value)) return false;
  return (
    isString(value.id, 128) &&
    isString(value.name, 200) &&
    ["admin", "editor", "contributor", "viewer"].includes(
      String(value.role),
    ) &&
    isNullableString(value.personId, 128) &&
    typeof value.canCapture === "boolean" &&
    typeof value.canReviewInbox === "boolean" &&
    typeof value.canCreateContributions === "boolean" &&
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
    isNullableString(value.ageLabel, 100) &&
    isDateTime(value.updatedAt) &&
    Number.isSafeInteger(value.assetCount) &&
    Number(value.assetCount) >= 0 &&
    Array.isArray(value.participantNames) &&
    value.participantNames.length <= 1000 &&
    value.participantNames.every((name) => isString(name, 200)) &&
    Array.isArray(value.captureIds) &&
    value.captureIds.length <= 1000 &&
    value.captureIds.every((id) => isString(id, 128)) &&
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

function isInboxAsset(value: unknown): value is MobileInboxAsset {
  return (
    isRecord(value) &&
    isString(value.id, 128) &&
    ["image", "video", "audio"].includes(String(value.type)) &&
    isString(value.filename, 500) &&
    isString(value.mimeType, 200) &&
    (value.capturedAt === null || isDateTime(value.capturedAt)) &&
    isPath(value.mediaPath) &&
    isNullablePath(value.thumbnailPath)
  );
}

function isInboxEntry(value: unknown): value is MobileInboxEntry {
  return (
    isRecord(value) &&
    isString(value.id, 128) &&
    ["text", "asset"].includes(String(value.kind)) &&
    isString(value.status, 32) &&
    isString(value.title, 500) &&
    isNullableString(value.rawText, 5000) &&
    (value.occurredAt === null || isDateTime(value.occurredAt)) &&
    (value.occurredAtWall === null || isWallDateTime(value.occurredAtWall)) &&
    isNullableString(value.locationText, 200) &&
    Array.isArray(value.participantPersonIds) &&
    value.participantPersonIds.length <= 50 &&
    value.participantPersonIds.every((id) => isString(id, 128)) &&
    isDateTime(value.createdAt) &&
    Array.isArray(value.assets) &&
    value.assets.length <= 100 &&
    value.assets.every(isInboxAsset)
  );
}

export function parseMobileInboxPage(value: unknown): MobileInboxPage {
  if (
    !hasCursor(value) ||
    !Array.isArray(value.entries) ||
    value.entries.length > 50 ||
    !value.entries.every(isInboxEntry)
  ) {
    throw new ApiError("服务器收件箱返回了无效数据。", 502);
  }
  return value as MobileInboxPage;
}

function isMemoryAsset(value: unknown): value is MobileMemoryAsset {
  return (
    isRecord(value) &&
    isString(value.id, 128) &&
    ["image", "video", "audio"].includes(String(value.type)) &&
    isString(value.filename, 500) &&
    isString(value.mimeType, 200) &&
    (value.durationMs === null || Number.isSafeInteger(value.durationMs)) &&
    isPath(value.mediaPath) &&
    isNullablePath(value.thumbnailPath)
  );
}

export function parseMobileMemory(value: unknown): MobileMemory {
  if (
    !isRecord(value) ||
    !isString(value.id, 128) ||
    !isString(value.title, 500) ||
    !isDateTime(value.occurredAt) ||
    !isWallDateTime(value.occurredAtWall) ||
    !isString(value.occurredAtPrecision, 32) ||
    (value.ageDays !== null && !Number.isSafeInteger(value.ageDays)) ||
    !isNullableString(value.ageLabel, 100) ||
    !isNullableString(value.locationText, 200) ||
    !isString(value.childPersonId, 128) ||
    !Array.isArray(value.participantPersonIds) ||
    !value.participantPersonIds.every((id) => isString(id, 128)) ||
    !Array.isArray(value.participants) ||
    !value.participants.every(
      (person) =>
        isRecord(person) &&
        isString(person.id, 128) &&
        isString(person.displayName, 200) &&
        isNullableString(person.relationToChild, 100) &&
        typeof person.isChild === "boolean",
    ) ||
    !Array.isArray(value.sourceNotes) ||
    !value.sourceNotes.every(
      (note) => isRecord(note) && isString(note.id, 128) && isString(note.text),
    ) ||
    !Array.isArray(value.assets) ||
    value.assets.length > 200 ||
    !value.assets.every(isMemoryAsset) ||
    !Array.isArray(value.contributions) ||
    !value.contributions.every(
      (contribution) =>
        isRecord(contribution) &&
        isString(contribution.id, 128) &&
        isString(contribution.authorPersonId, 128) &&
        isString(contribution.authorName, 200) &&
        isString(contribution.text) &&
        ["private", "parents", "family", "child_later"].includes(
          String(contribution.visibility),
        ) &&
        typeof contribution.canEdit === "boolean" &&
        isNullablePath(contribution.audioPath),
    ) ||
    !isDateTime(value.updatedAt)
  ) {
    throw new ApiError("服务器记忆详情返回了无效数据。", 502);
  }
  return value as MobileMemory;
}

export function parseMobileHome(value: unknown): MobileHome {
  const validChild = value && isRecord(value) && (value.child === null || (
    isRecord(value.child) &&
    isString(value.child.id, 128) &&
    isString(value.child.displayName, 200) &&
    isNullableString(value.child.currentAgeLabel, 100) &&
    isNullablePath(value.child.avatarPath)
  ));
  const validInbox = value && isRecord(value) && isRecord(value.inbox) &&
    Number.isSafeInteger(value.inbox.count) && Number(value.inbox.count) >= 0 &&
    Array.isArray(value.inbox.previews) && value.inbox.previews.length <= 10 &&
    value.inbox.previews.every((preview) =>
      isRecord(preview) && isString(preview.id, 128) &&
      isString(preview.title, 500) && isString(preview.status, 32) &&
      isNullablePath(preview.mediaPath));
  const validRecent = value && isRecord(value) && Array.isArray(value.recentMemories) &&
    value.recentMemories.length <= 10 && value.recentMemories.every((memory) =>
      isRecord(memory) && isString(memory.id, 128) && isString(memory.title, 500) &&
      isDateTime(memory.occurredAt) && isNullableString(memory.ageLabel, 100) &&
      isNullablePath(memory.coverPath));
  const validOnThisDay = value && isRecord(value) && Array.isArray(value.onThisDay) &&
    value.onThisDay.length <= 10 && value.onThisDay.every((memory) =>
      isRecord(memory) && isString(memory.id, 128) && isString(memory.title, 500) &&
      isDateTime(memory.occurredAt));
  const validStory = value && isRecord(value) && (value.story === null || (
    isRecord(value.story) && isString(value.story.id, 128) &&
    isString(value.story.title, 500) && isString(value.story.status, 32)));
  const validCapsule = value && isRecord(value) && (value.capsule === null || (
    isRecord(value.capsule) && isString(value.capsule.id, 128) &&
    isString(value.capsule.title, 500) && isString(value.capsule.status, 32) &&
    isString(value.capsule.unlockType, 32) && isString(value.capsule.unlockValue, 200) &&
    typeof value.capsule.unlocked === "boolean"));
  if (
    !isRecord(value) ||
    !isRecord(value.family) ||
    !isString(value.family.name, 500) ||
    !isString(value.family.timezone, 100) ||
    !validChild ||
    !isRecord(value.capabilities) ||
    typeof value.capabilities.canCapture !== "boolean" ||
    !validInbox ||
    !validRecent ||
    !validOnThisDay ||
    !validStory ||
    !validCapsule ||
    !isRecord(value.prompt) ||
    !isString(value.prompt.text, 1000) ||
    !isNullableString(value.prompt.recipientLabel, 200) ||
    !Number.isSafeInteger(value.prompt.pendingCount) ||
    typeof value.prompt.isCreatedRequest !== "boolean" ||
    typeof value.isFirstUse !== "boolean"
  ) {
    throw new ApiError("服务器首页返回了无效数据。", 502);
  }
  return value as MobileHome;
}

export function parseMobileSearchPage(value: unknown): MobileSearchPage {
  if (
    !hasCursor(value) ||
    !Array.isArray(value.items) ||
    value.items.length > 50 ||
    !value.items.every(
      (item) =>
        isRecord(item) &&
        ["memory", "fact", "contribution", "transcript", "story"].includes(
          String(item.type),
        ) &&
        isString(item.id, 128) &&
        (item.eventId === null || isString(item.eventId, 128)) &&
        isString(item.title, 500) &&
        isString(item.snippet, 5000),
    )
  ) {
    throw new ApiError("服务器搜索返回了无效数据。", 502);
  }
  return value as MobileSearchPage;
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

async function requestMobileJson(
  credentials: Credentials,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${credentials.serverUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${credentials.token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError("无法连接家庭服务器，本机资料不受影响。", 0);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    if (response.ok) throw new ApiError("服务器返回了无效数据。", 502);
  }
  if (!response.ok) {
    const message =
      response.status === 401
        ? "登录已过期，请重新登录。"
        : response.status === 403
          ? "当前账号没有执行这个操作的权限。"
          : response.status === 404
            ? "这份家庭资料不存在或已经移除。"
            : "家庭服务器暂时无法完成这个操作。";
    throw new ApiError(message, response.status);
  }
  return body;
}

export async function fetchMobileHome(
  credentials: Credentials,
): Promise<MobileHome> {
  return parseMobileHome(
    await requestMobileJson(credentials, "/api/mobile/v1/home"),
  );
}

export async function fetchMobileInbox(
  credentials: Credentials,
  cursor: string | null = null,
): Promise<MobileInboxPage> {
  const query = new URLSearchParams({ limit: "25" });
  if (cursor) query.set("cursor", cursor);
  return parseMobileInboxPage(
    await requestMobileJson(
      credentials,
      `/api/mobile/v1/inbox?${query.toString()}`,
    ),
  );
}

export async function patchMobileInbox(
  credentials: Credentials,
  id: string,
  patch: InboxDraftPatch,
): Promise<MobileInboxEntry> {
  const result = await requestMobileJson(
    credentials,
    `/api/mobile/v1/inbox/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  if (!isRecord(result) || !isInboxEntry(result.entry)) {
    throw new ApiError("服务器收件箱返回了无效数据。", 502);
  }
  return result.entry;
}

export async function confirmMobileInbox(
  credentials: Credentials,
  id: string,
): Promise<string> {
  const result = await requestMobileJson(
    credentials,
    `/api/mobile/v1/inbox/${encodeURIComponent(id)}/confirm`,
    { method: "POST", body: "{}" },
  );
  if (!isRecord(result) || !isString(result.memoryEventId, 128)) {
    throw new ApiError("服务器确认结果无效。", 502);
  }
  return result.memoryEventId;
}

export async function mergeMobileInbox(
  credentials: Credentials,
  itemIds: string[],
  title: string,
): Promise<string> {
  const result = await requestMobileJson(
    credentials,
    "/api/mobile/v1/inbox/merge",
    { method: "POST", body: JSON.stringify({ itemIds, title }) },
  );
  if (!isRecord(result) || !isString(result.memoryEventId, 128)) {
    throw new ApiError("服务器合并结果无效。", 502);
  }
  return result.memoryEventId;
}

export async function fetchMobileMemory(
  credentials: Credentials,
  id: string,
): Promise<MobileMemory> {
  return parseMobileMemory(
    await requestMobileJson(
      credentials,
      `/api/mobile/v1/memories/${encodeURIComponent(id)}`,
    ),
  );
}

export async function patchMobileMemory(
  credentials: Credentials,
  id: string,
  patch: InboxDraftPatch,
): Promise<MobileMemory> {
  return parseMobileMemory(
    await requestMobileJson(
      credentials,
      `/api/mobile/v1/memories/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),
  );
}

export async function createMobileContribution(
  credentials: Credentials,
  memoryEventId: string,
  input: MobileContributionInput,
): Promise<string> {
  const result = await requestMobileJson(
    credentials,
    `/api/mobile/v1/memories/${encodeURIComponent(memoryEventId)}/contributions`,
    { method: "POST", body: JSON.stringify(input) },
  );
  if (!isRecord(result) || !isString(result.contributionId, 128)) {
    throw new ApiError("服务器讲述创建结果无效。", 502);
  }
  return result.contributionId;
}

export async function updateMobileContribution(
  credentials: Credentials,
  contributionId: string,
  text: string,
): Promise<string> {
  const result = await requestMobileJson(
    credentials,
    `/api/mobile/v1/contributions/${encodeURIComponent(contributionId)}`,
    { method: "PATCH", body: JSON.stringify({ text }) },
  );
  if (!isRecord(result) || !isString(result.memoryEventId, 128)) {
    throw new ApiError("服务器讲述修改结果无效。", 502);
  }
  return result.memoryEventId;
}

export async function searchMobile(
  credentials: Credentials,
  queryText: string,
  cursor: string | null = null,
): Promise<MobileSearchPage> {
  const query = new URLSearchParams({ q: queryText, limit: "25" });
  if (cursor) query.set("cursor", cursor);
  return parseMobileSearchPage(
    await requestMobileJson(
      credentials,
      `/api/mobile/v1/search?${query.toString()}`,
    ),
  );
}

export async function uploadTextCapture(
  credentials: Credentials,
  id: string,
  text: string,
): Promise<string> {
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
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new ApiError("服务器文字上传结果无效。", 502);
  }
  if (!isRecord(result) || !isString(result.inboxItemId, 128)) {
    throw new ApiError("服务器文字上传结果无效。", 502);
  }
  return result.inboxItemId;
}
