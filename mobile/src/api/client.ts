import type {
  BootstrapInfo,
  Credentials,
  InboxDraftPatch,
  InvitationCreateInput,
  InvitationCreateResult,
  InvitationPreview,
  MobileHome,
  MobileContributionInput,
  MobileInboxAsset,
  MobileInboxEntry,
  MobileInboxPage,
  MobileLibraryDetail,
  MobileLibraryDomain,
  MobileLibraryMutationResult,
  MobileLibraryPage,
  MobileMe,
  MobileMemory,
  MobileMemoryPatch,
  MemorySharingPatch,
  MemorySharingResult,
  MobileReview,
  MobileMemoryAsset,
  MobileSearchPage,
  OnboardingInput,
  Person,
  SyncPage,
  TimelineEvent,
  Viewer,
} from "../types";

type SignInResponse = {
  token?: unknown;
  twoFactorRedirect?: unknown;
  user?: { id?: unknown; name?: unknown };
  message?: unknown;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type TwoFactorChallenge = { serverUrl: string; challenge: string };

export class TwoFactorRequiredError extends Error {
  constructor(readonly pending: TwoFactorChallenge) {
    super("请输入验证器动态码或一次性恢复码。");
    this.name = "TwoFactorRequiredError";
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
    ["owner", "admin", "editor", "contributor", "viewer"].includes(
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
    (value.titleRevision === undefined || (Number.isSafeInteger(value.titleRevision) && Number(value.titleRevision) >= 0)) &&
    isDateTime(value.occurredAt) &&
    isString(value.occurredAtPrecision, 32) &&
    isNullableString(value.locationText, 500) &&
    (value.childPersonId === null || isString(value.childPersonId, 128)) &&
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
  if (value.sync !== undefined) {
    const sync = value.sync;
    if (!isRecord(sync) || sync.protocol !== 2 || !["snapshot","delta"].includes(String(sync.mode)) ||
      !isString(sync.generation,128) || !sync.generation || !isString(sync.permissionStamp,128) || !sync.permissionStamp ||
      typeof sync.invalidateResources !== "boolean" ||
      !(sync.checkpoint === null || (isString(sync.checkpoint,512) && sync.checkpoint.length > 0)) ||
      (value.nextCursor === null ? sync.checkpoint === null : sync.checkpoint !== null) ||
      value.people.length > 50 || !Array.isArray(value.tombstones) || value.tombstones.length > 50 ||
      !value.tombstones.every(row => isRecord(row) && ["memory","person"].includes(String(row.kind)) && isString(row.id,128) && row.id.length > 0)) {
      throw new ApiError("服务器增量同步返回了无效数据。",502);
    }
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
    ["text", "asset", "bundle"].includes(String(value.kind)) &&
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
    (value.bodyText !== undefined && !isString(value.bodyText, 100_000)) ||
    (value.canWrite !== undefined && typeof value.canWrite !== "boolean") ||
    (value.isAuthor !== undefined && typeof value.isAuthor !== "boolean") ||
    (value.visibility !== undefined && !["private", "members", "family"].includes(String(value.visibility))) ||
    (value.readerUserIds !== undefined && (!Array.isArray(value.readerUserIds) || value.readerUserIds.length > 20 || !value.readerUserIds.every(id => isString(id, 128)))) ||
    (value.titleRevision !== undefined && (!Number.isSafeInteger(value.titleRevision) || Number(value.titleRevision) < 0)) ||
    !isString(value.title, 500) ||
    !isDateTime(value.occurredAt) ||
    !isWallDateTime(value.occurredAtWall) ||
    !isString(value.occurredAtPrecision, 32) ||
    (value.ageDays !== null && !Number.isSafeInteger(value.ageDays)) ||
    !isNullableString(value.ageLabel, 100) ||
    !isNullableString(value.locationText, 200) ||
    !(value.childPersonId === null || isString(value.childPersonId, 128)) ||
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
  const validWeeklyReview = value && isRecord(value) && isRecord(value.weeklyReview) &&
    isString(value.weeklyReview.key, 10) && isString(value.weeklyReview.status, 32) &&
    Number.isSafeInteger(value.weeklyReview.confirmedCount) && Number(value.weeklyReview.confirmedCount) >= 0 &&
    Number.isSafeInteger(value.weeklyReview.pendingInboxCount) && Number(value.weeklyReview.pendingInboxCount) >= 0 &&
    isNullableString(value.weeklyReview.storyId, 128);
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
    !validWeeklyReview ||
    (value.monthlyReview !== undefined && (!isRecord(value.monthlyReview) || !isString(value.monthlyReview.month,7) || !isString(value.monthlyReview.startDate,10) || !isString(value.monthlyReview.endDate,10) || !Number.isSafeInteger(value.monthlyReview.count) || Number(value.monthlyReview.count)<0)) ||
    (value.activeBooks !== undefined && (!Array.isArray(value.activeBooks) || !value.activeBooks.every(b=>isRecord(b)&&isString(b.id,128)&&isString(b.title,200)&&isString(b.subtitle,500)))) ||
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
      credentials: "omit",
      redirect: "error",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin: new URL(serverUrl).origin,
        "x-ftc-native-auth": "1",
      },
      body: JSON.stringify({ email: email.trim(), password, rememberMe: true }),
    });
  } catch {
    throw new ApiError("无法连接家庭服务器，请检查地址和网络。", 0);
  }
  let body: SignInResponse = {};
  try {
    const parsed: unknown = await response.json();
    body = isRecord(parsed) ? parsed : {};
  } catch {
    // Keep the stable status-based error below for reverse-proxy HTML errors.
  }
  if (response.ok && body.twoFactorRedirect === true) {
    const challenge = response.headers.get("x-ftc-two-factor-challenge");
    if (!challenge || !/^[A-Za-z0-9%._~+/=-]{1,1024}$/u.test(challenge)) {
      throw new ApiError("此服务器尚不支持 App 两步验证登录，请升级服务器后重试。", 409, "native_auth_upgrade_required");
    }
    throw new TwoFactorRequiredError({ serverUrl, challenge });
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

export async function verifyTwoFactor(pending: TwoFactorChallenge, code: string, method: "totp" | "backup"): Promise<Credentials> {
  const serverUrl = normalizeServerUrl(pending.serverUrl);
  let response: Response;
  try {
    response = await fetchWithTimeout(`${serverUrl}/api/auth/two-factor/verify-${method === "totp" ? "totp" : "backup-code"}`, {
      method: "POST", credentials: "omit", redirect: "error",
      headers: { "content-type": "application/json", origin: new URL(serverUrl).origin, "x-ftc-native-auth": "1", "x-ftc-two-factor-challenge": pending.challenge },
      body: JSON.stringify({ code: code.trim(), trustDevice: false }),
    });
  } catch {
    throw new ApiError("验证响应未收到。请重试；若提示已失效，请重新登录。", 0);
  }
  const parsed: unknown = await response.json().catch(() => ({}));
  const body = isRecord(parsed) ? parsed : {};
  const token = response.headers.get("set-auth-token") ?? (typeof body.token === "string" ? body.token : null);
  if (!response.ok || !token) {
    const invalid = body.error === "invalid_challenge" || body.code === "INVALID_TWO_FACTOR_COOKIE" || body.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE";
    throw new ApiError(response.status === 429 ? "验证尝试过多，请稍后重新登录。" : invalid ? "本次验证已失效，请重新登录。" : "验证码不正确或已使用，请核对后重试。", response.status, invalid ? "challenge_expired" : "verification_failed");
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

function isBootstrapInfo(value: unknown): value is BootstrapInfo {
  if (!isRecord(value)) return false;
  if (!isString(value.product, 100)) return false;
  if (typeof value.apiVersion !== "number") return false;
  if (!isString(value.instanceId, 128)) return false;
  const setup = value.setup;
  if (!isRecord(setup)) return false;
  return ["available", "completed", "unconfigured"].includes(String(setup.state));
}

/** 探测一个地址是否是本产品的自托管实例（GET /api/bootstrap）。 */
export async function fetchBootstrap(
  serverValue: string,
): Promise<{ serverUrl: string; info: BootstrapInfo }> {
  const serverUrl = normalizeServerUrl(serverValue);
  let response: Response;
  try {
    response = await fetchWithTimeout(`${serverUrl}/api/bootstrap`, {
      headers: { accept: "application/json" },
    });
  } catch {
    throw new ApiError("无法连接家庭空间，请检查地址和网络。", 0);
  }
  if (!response.ok) {
    throw new ApiError(
      response.status === 503
        ? "服务暂时不可用，可能正在启动或维护，请稍后再试。"
        : "该地址无法作为家庭空间使用，请核对后重试。",
      response.status,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!isBootstrapInfo(body)) {
    throw new ApiError("该地址不是家庭时间胶囊服务，请核对后重试。", 502);
  }
  return { serverUrl, info: body };
}

export type BootstrapSetupInput = {
  token: string;
  displayName: string;
  email: string;
  password: string;
};

/** App 内创建首个管理员（POST /api/bootstrap/setup）。 */
export async function bootstrapSetup(
  serverUrl: string,
  input: BootstrapSetupInput,
): Promise<void> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${serverUrl}/api/bootstrap/setup`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new ApiError("无法连接家庭空间，请检查地址和网络。", 0);
  }
  if (response.ok) return;
  const code = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const error = code && typeof code.error === "string" ? code.error : "";
  if (response.status === 403 || error === "invalid_token") {
    throw new ApiError("初始化令牌不正确。", response.status);
  }
  if (error === "already_initialized") {
    throw new ApiError("该家庭空间已完成初始化，请直接登录。", response.status);
  }
  if (response.status === 429 || error === "rate_limited") {
    throw new ApiError("尝试过于频繁，请 15 分钟后再试。", response.status);
  }
  if (error === "invalid_input") {
    throw new ApiError("请检查填写内容：称呼 1–50 字，邮箱格式正确，密码至少 10 位。", response.status);
  }
  if (error === "not_configured") {
    throw new ApiError("该服务器未配置初始化令牌，请先在服务器上设置。", response.status);
  }
  throw new ApiError("初始化失败，请稍后重试。", response.status);
}

function isMobileMe(value: unknown): value is MobileMe {
  if (!isRecord(value)) return false;
  if (!["needsOnboarding", "ready", "revoked"].includes(String(value.status))) {
    return false;
  }
  return true;
}

/** 账号与家庭状态（GET /api/mobile/v1/me）。401 表示会话已失效。 */
export async function fetchMe(credentials: Credentials): Promise<MobileMe> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${credentials.serverUrl}/api/mobile/v1/me`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${credentials.token}`,
      },
    });
  } catch {
    throw new ApiError("无法连接家庭服务器，本地数据不受影响。", 0);
  }
  if (response.status === 401) {
    throw new ApiError("登录已过期，请重新登录。", 401);
  }
  if (!response.ok) {
    throw new ApiError("暂时无法获取账号状态，请稍后再试。", response.status);
  }
  const body = await response.json().catch(() => null);
  if (!isMobileMe(body)) {
    throw new ApiError("服务器返回了无效数据。", 502);
  }
  return body;
}

/** 建立家庭（POST /api/mobile/v1/onboarding）。 */
export async function submitOnboarding(
  credentials: Credentials,
  input: OnboardingInput,
): Promise<void> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${credentials.serverUrl}/api/mobile/v1/onboarding`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${credentials.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      },
    );
  } catch {
    throw new ApiError("无法连接家庭服务器，请检查网络后重试。", 0);
  }
  if (response.ok) return;
  const code = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const error = code && typeof code.error === "string" ? code.error : "";
  if (error === "already_bound") {
    throw new ApiError("该账号已有家庭，无需重复建立。", response.status);
  }
  if (error === "invalid_input") {
    throw new ApiError("请检查填写内容：家庭名与称呼 1–50 字，出生日期为有效日期。", response.status);
  }
  if (response.status === 401) {
    throw new ApiError("登录已过期，请重新登录。", 401);
  }
  throw new ApiError("建立家庭失败，请稍后重试。", response.status);
}

export type ParsedInviteLink = { serverUrl: string; token: string };

/**
 * 解析完整邀请链接（https://…/invite/<token> 或白名单深链
 * familytimecapsule://join?server=<origin>&token=<token>）。
 * 只取 origin，绝不携带 query/fragment/凭据。
 */
export function parseInviteLink(value: string): ParsedInviteLink | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "familytimecapsule:") {
      if (url.host !== "join") return null;
      const server = url.searchParams.get("server") ?? "";
      const token = url.searchParams.get("token") ?? "";
      if (!/^https:\/\/[^\s/?#@]+$/u.test(server) || !token) return null;
      return { serverUrl: server, token };
    }
    if (!/^https?:\/\//iu.test(trimmed)) return null;
    if (url.username || url.password || url.search) return null;
    const match = /^\/invite\/([A-Za-z0-9_-]+)\/?$/u.exec(url.pathname);
    const token = match?.[1];
    if (!token) return null;
    return { serverUrl: url.origin, token };
  } catch {
    return null;
  }
}

function isInvitationPreview(value: unknown): value is InvitationPreview {
  if (!isRecord(value)) return false;
  const status = String(value.status);
  if (!["invalid", "active", "claimed", "expired", "revoked", "used"].includes(status)) {
    return false;
  }
  if (status === "invalid") return true;
  return isString(value.familyName, 100) && isString(value.role, 20);
}

/** 受邀人查看邀请（GET /api/invitations/preview，不消耗邀请）。 */
export async function previewInvitation(
  serverUrl: string,
  token: string,
): Promise<InvitationPreview> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${serverUrl}/api/invitations/preview?token=${encodeURIComponent(token)}`,
      { headers: { accept: "application/json" } },
    );
  } catch {
    throw new ApiError("无法连接家庭空间，请检查地址和网络。", 0);
  }
  if (!response.ok) {
    throw new ApiError("暂时无法查看邀请，请稍后再试。", response.status);
  }
  const body = await response.json().catch(() => null);
  if (!isInvitationPreview(body)) {
    throw new ApiError("服务器返回了无效数据。", 502);
  }
  return body;
}

export type AcceptInvitationInput = {
  token: string;
  displayName: string;
  email: string;
  password: string;
};

/** 受邀人注册并加入家庭（POST /api/invitations/accept）。 */
export async function acceptInvitation(
  serverUrl: string,
  input: AcceptInvitationInput,
): Promise<void> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${serverUrl}/api/invitations/accept`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new ApiError("无法连接家庭空间，请检查地址和网络。", 0);
  }
  if (response.ok) return;
  const code = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const error = code && typeof code.error === "string" ? code.error : "";
  if (error === "invalid_input") {
    throw new ApiError("请检查填写内容：称呼 1–50 字，邮箱格式正确，密码至少 10 位。", response.status);
  }
  if (error === "invalid_or_unavailable") {
    throw new ApiError("邀请已过期、已撤销、已使用，或正在被接受。", response.status);
  }
  if (error === "email_mismatch") {
    throw new ApiError("此邀请限定了另一个邮箱，请使用邀请中指定的邮箱。", response.status);
  }
  if (error === "account_exists") {
    throw new ApiError("该邮箱已有账号，请直接登录。", response.status);
  }
  if (error === "person_unavailable") {
    throw new ApiError("邀请绑定的家人档案已关联账号，请联系家庭管理员。", response.status);
  }
  throw new ApiError("注册失败，请稍后重试。", response.status);
}

/** 在 App 内创建账号邀请（POST /api/mobile/v1/invitations）。 */
export async function createInvitation(
  credentials: Credentials,
  input: InvitationCreateInput,
): Promise<InvitationCreateResult> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${credentials.serverUrl}/api/mobile/v1/invitations`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${credentials.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      },
    );
  } catch {
    throw new ApiError("无法连接家庭服务器，请检查网络后重试。", 0);
  }
  if (response.ok) {
    const body = (await response.json().catch(() => null)) as unknown;
    if (
      isRecord(body) &&
      isString(body.token, 512) &&
      isString(body.invitePath, 1024) &&
      isString(body.invitationId, 128) &&
      isString(body.expiresAt, 64)
    ) {
      return {
        invitationId: body.invitationId,
        token: body.token,
        invitePath: body.invitePath,
        expiresAt: body.expiresAt,
      };
    }
    throw new ApiError("服务器返回了无效数据。", 502);
  }
  const code = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const error = code && typeof code.error === "string" ? code.error : "";
  if (response.status === 403 || error === "forbidden") {
    throw new ApiError("只有家庭管理员可以创建邀请。", response.status);
  }
  if (error === "person_unavailable") {
    throw new ApiError("所选家人不属于当前家庭，或已经绑定账号。", response.status);
  }
  if (response.status === 401) {
    throw new ApiError("登录已过期，请重新登录。", 401);
  }
  throw new ApiError("创建邀请失败，请稍后重试。", response.status);
}

export async function fetchSyncPage(
  credentials: Credentials,
  cursor: string | null,
): Promise<SyncPage> {
  const url = new URL(`${credentials.serverUrl}/api/mobile/v1/sync`);
  url.searchParams.set("limit", "50");
  url.searchParams.set("protocol", "2");
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
    const errorBody = await response.json().catch(() => null);
    const code = isRecord(errorBody) && ["sync_reset","sync_changed"].includes(String(errorBody.error)) ? String(errorBody.error) : undefined;
    throw new ApiError(
      response.status === 401 ? "登录已过期，请重新登录。" : "同步失败，请稍后重试。",
      response.status,
      code,
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

export async function requestMobileJson(
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
      isRecord(body) && body.error === "invalid_reader"
        ? "指定成员已停用、退出或不属于当前家庭。请重新选择读者；本机内容仍保留，不会改为全家可见。"
        : isRecord(body) && body.error === "conflict"
        ? "内容已有新的修改，请重新读取后核对。本次输入仍保留在页面中。"
        : isRecord(body) && body.error === "source_reshare_forbidden"
        ? "其中有其他家人未授权转分享的内容，不能扩大读者。可以保留或缩小当前范围。"
        : isRecord(body) && body.error === "asset_in_use"
        ? "这份原件仍被草稿、记忆、相册或作品使用。请先移除相关引用。"
        : response.status === 401
        ? "登录已过期，请重新登录。"
        : response.status === 403
          ? "当前账号没有执行这个操作的权限。"
          : response.status === 404
            ? "这份家庭资料不存在或已经移除。"
            : "家庭服务器暂时无法完成这个操作。";
    throw new ApiError(message, response.status, isRecord(body) && typeof body.error === "string" && /^[a-z_]{1,80}$/.test(body.error) ? body.error : undefined);
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

export function parseAiSettings(value: unknown): import("../ai/types").AiSettings {
  const validQuota = (quota: unknown) => quota === undefined || quota === null || (
    isRecord(quota) && typeof quota.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(quota.day) &&
    isRecord(quota.limits) && isRecord(quota.used) &&
    [quota.limits.maxRequests, quota.limits.maxImages, quota.limits.maxAudioSeconds, quota.used.requests, quota.used.images, quota.used.audioSeconds].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0)
  );
  if (!isRecord(value) || !validQuota(value.quota) || ![value.valid, value.configured, value.external, value.canConfigure, value.workerAvailable].every(flag => typeof flag === "boolean") || !isNullableString(value.configurationId, 128) || !isNullableString(value.provider, 100) || !Array.isArray(value.capabilities) || value.capabilities.length !== 3 || new Set(value.capabilities.map(row => isRecord(row) ? row.capability : null)).size !== 3 || !value.capabilities.every(row => isRecord(row) && ["text", "vision", "transcription"].includes(String(row.capability)) && isNullableString(row.model, 256) && typeof row.available === "boolean" && typeof row.consented === "boolean" && isRecord(row.check) && ["untested", "passed", "failed"].includes(String(row.check.state)) && (row.check.testedAt === null || isDateTime(row.check.testedAt)) && isNullableString(row.check.code, 64))) {
    throw new ApiError("服务器 AI 状态无效，请升级配套服务端。", 502);
  }
  return value as import("../ai/types").AiSettings;
}

export async function fetchAiSettings(credentials: Credentials) {
  return parseAiSettings(await requestMobileJson(credentials, "/api/mobile/v1/ai/settings"));
}

export async function changeAiConsent(credentials: Credentials, capability: import("../ai/types").OrganizerCapability, operation: "enable" | "disable", configurationId: string | null) {
  return parseAiSettings(await requestMobileJson(credentials, "/api/mobile/v1/ai/settings", { method: "POST", body: JSON.stringify({ capability, operation, configurationId }) }));
}

export function parseNameReview(value: unknown): import("../names/types").NameReview {
  const revision = (number: unknown) => Number.isSafeInteger(number) && Number(number) >= 0;
  if (!isRecord(value) || !isRecord(value.target) || !["asset", "inbox_item", "memory_event"].includes(String(value.target.kind)) || !isString(value.target.id, 128) || !isNullableString(value.target.text, 100) || !isString(value.target.source, 32) || !revision(value.target.revision) || !Array.isArray(value.suggestions) || value.suggestions.length > 50 || !value.suggestions.every(row => isRecord(row) && isString(row.id, 128) && isString(row.title, 100) && ["pending", "accepted", "rejected", "undone"].includes(String(row.status)) && revision(row.revision) && (row.targetRevision === null || revision(row.targetRevision)) && typeof row.valid === "boolean" && typeof row.canUndo === "boolean")) throw new ApiError("服务器名称审核数据无效。", 502);
  return value as import("../names/types").NameReview;
}

export async function fetchNameReview(credentials: Credentials, kind: import("../names/types").NameKind, id: string) {
  return parseNameReview(await requestMobileJson(credentials, `/api/mobile/v1/names?${new URLSearchParams({ kind, id })}`));
}

export async function mutateNameReview(credentials: Credentials, input: Record<string, unknown>) {
  return parseNameReview(await requestMobileJson(credentials, "/api/mobile/v1/names", { method: "POST", body: JSON.stringify(input) }));
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
  draft?: InboxDraftPatch,
  expectedTitleRevision?: number,
): Promise<string> {
  const result = await requestMobileJson(
    credentials,
    `/api/mobile/v1/inbox/${encodeURIComponent(id)}/confirm`,
    // 确认携带当前未单独保存的编辑字段，服务端在同一事务里保存并确认。
    { method: "POST", body: JSON.stringify({ ...(draft ?? {}), expectedTitleRevision }) },
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

export async function shareMobileMemory(credentials: Credentials, id: string, patch: MemorySharingPatch): Promise<MemorySharingResult> {
  const body = await requestMobileJson(credentials, `/api/mobile/v1/memories/${encodeURIComponent(id)}/sharing`, { method: "POST", body: JSON.stringify(patch) });
  if (!isRecord(body) || body.ok !== true || !["private", "members", "family"].includes(String(body.visibility)) ||
    !Number.isSafeInteger(body.titleRevision) || Number(body.titleRevision) < 0 || typeof body.readable !== "boolean" ||
    !Array.isArray(body.readerUserIds) || body.readerUserIds.length > 20 || !body.readerUserIds.every(id => isString(id, 128))) throw new ApiError("服务器分享设置返回了无效数据。", 502);
  return body as MemorySharingResult;
}

export async function patchMobileMemory(
  credentials: Credentials,
  id: string,
  patch: MobileMemoryPatch,
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

export type MobileSearchFilterInput = {
  personId?: string;
  dateFrom?: string;
  dateTo?: string;
  mediaType?: "image" | "video" | "audio" | "document";
};

export async function searchMobile(
  credentials: Credentials,
  queryText: string,
  cursor: string | null = null,
  filters: MobileSearchFilterInput = {},
): Promise<MobileSearchPage> {
  const query = new URLSearchParams({ q: queryText, limit: "25" });
  if (cursor) query.set("cursor", cursor);
  if (filters.personId) query.set("personId", filters.personId);
  if (filters.dateFrom) query.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) query.set("dateTo", filters.dateTo);
  if (filters.mediaType) query.set("mediaType", filters.mediaType);
  return parseMobileSearchPage(
    await requestMobileJson(
      credentials,
      `/api/mobile/v1/search?${query.toString()}`,
    ),
  );
}

function parseMobileLibraryPage(value: unknown): MobileLibraryPage {
  if (!hasCursor(value) || !Array.isArray(value.items) || value.items.length > 50 || !value.items.every((item) => (
    isRecord(item) && isString(item.id, 128) && isString(item.title, 500) &&
    isNullableString(item.subtitle, 1_000) && isNullableString(item.status, 64) &&
    isDateTime(item.updatedAt) && isRecord(item.meta)
  ))) {
    throw new ApiError("服务器家庭资料列表无效。", 502);
  }
  return value as MobileLibraryPage;
}

function parseMobileLibraryDetail(value: unknown): MobileLibraryDetail {
  if (!isRecord(value) || !isString(value.id, 128) || !isString(value.title, 500)) {
    throw new ApiError("服务器家庭资料详情无效。", 502);
  }
  return value as MobileLibraryDetail;
}

export async function fetchMobileLibraryPage(
  credentials: Credentials,
  domain: MobileLibraryDomain,
  cursor: string | null = null,
): Promise<MobileLibraryPage> {
  const query = new URLSearchParams({ limit: "25" });
  if (cursor) query.set("cursor", cursor);
  return parseMobileLibraryPage(await requestMobileJson(
    credentials,
    `/api/mobile/v1/library/${domain}?${query.toString()}`,
  ));
}

export async function fetchMobileLibraryDetail(
  credentials: Credentials,
  domain: MobileLibraryDomain,
  id: string,
): Promise<MobileLibraryDetail> {
  return parseMobileLibraryDetail(await requestMobileJson(
    credentials,
    `/api/mobile/v1/library/${domain}/${encodeURIComponent(id)}`,
  ));
}

function parseLibraryMutation(value: unknown): MobileLibraryMutationResult {
  if (!isRecord(value)) throw new ApiError("服务器写入结果无效。", 502);
  if (value.id !== undefined && !isString(value.id, 128)) throw new ApiError("服务器写入结果无效。", 502);
  if (value.token !== undefined && !isString(value.token, 256)) throw new ApiError("服务器写入结果无效。", 502);
  if (value.expiresAt !== undefined && !isDateTime(value.expiresAt)) throw new ApiError("服务器写入结果无效。", 502);
  return value as MobileLibraryMutationResult;
}

export async function createMobileLibraryItem(
  credentials: Credentials,
  domain: MobileLibraryDomain,
  input: Record<string, unknown>,
): Promise<MobileLibraryMutationResult> {
  return parseLibraryMutation(await requestMobileJson(
    credentials,
    `/api/mobile/v1/library/${domain}`,
    { method: "POST", body: JSON.stringify(input) },
  ));
}

export async function mutateMobileLibraryItem(
  credentials: Credentials,
  domain: MobileLibraryDomain,
  id: string,
  input: Record<string, unknown>,
): Promise<MobileLibraryMutationResult> {
  return parseLibraryMutation(await requestMobileJson(
    credentials,
    `/api/mobile/v1/library/${domain}/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  ));
}

export function parseMobileReview(value: unknown): MobileReview {
  const validCount = (entry: unknown) => Number.isSafeInteger(entry) && Number(entry) >= 0;
  if (
    !isRecord(value) || !isString(value.id, 128) || !isString(value.key, 10) ||
    !isDateTime(value.periodStart) || !isDateTime(value.periodEnd) ||
    !["open", "in_progress", "completed"].includes(String(value.status)) ||
    !isNullableString(value.storyId, 128) || !isNullableString(value.startedAt, 64) ||
    !isNullableString(value.completedAt, 64) || typeof value.canWrite !== "boolean" ||
    !isRecord(value.preferences) || !isString(value.preferences.timezone, 100) ||
    !Number.isSafeInteger(value.preferences.weekStartsOn) || !Number.isSafeInteger(value.preferences.reminderWeekday) ||
    !isString(value.preferences.reminderLocalTime, 5) ||
    typeof value.preferences.remindPendingInbox !== "boolean" ||
    typeof value.preferences.remindPendingRequests !== "boolean" ||
    typeof value.preferences.remindUpcomingCapsules !== "boolean" ||
    !isRecord(value.counts) || ![
      value.counts.inbox, value.counts.needsReview, value.counts.duplicateSuggestions,
      value.counts.clusterSuggestions, value.counts.guestSubmissions, value.counts.failedImports,
      value.counts.pendingRequests, value.counts.upcomingCapsules,
    ].every(validCount) || (value.reminderAt !== null && !isDateTime(value.reminderAt)) ||
    !Array.isArray(value.events) || value.events.length > 50 || !value.events.every((event) => (
      isRecord(event) && isString(event.id, 128) && isString(event.title, 500) &&
      isDateTime(event.occurredAt) && isNullableString(event.locationText, 500) &&
      Array.isArray(event.participantNames) && event.participantNames.length <= 100 &&
      event.participantNames.every((name) => isString(name, 200)) &&
      isNullableString(event.milestoneType, 32) && validCount(event.contributionCount) &&
      typeof event.selected === "boolean"
    ))
  ) throw new ApiError("服务器每周回顾返回了无效数据。", 502);
  return value as MobileReview;
}

export async function fetchMobileReview(credentials: Credentials): Promise<MobileReview> {
  return parseMobileReview(await requestMobileJson(credentials, "/api/mobile/v1/review"));
}

export async function mutateMobileReview(
  credentials: Credentials,
  input: Record<string, unknown>,
): Promise<{ review: MobileReview; storyId?: string }> {
  const value = await requestMobileJson(credentials, "/api/mobile/v1/review", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  if (!isRecord(value) || !isRecord(value.review) || (value.storyId !== undefined && !isString(value.storyId, 128))) {
    throw new ApiError("服务器每周回顾写入结果无效。", 502);
  }
  return { review: parseMobileReview(value.review), ...(typeof value.storyId === "string" ? { storyId: value.storyId } : {}) };
}

export async function uploadTextCapture(
  credentials: Credentials,
  id: string,
  text: string,
  importSessionId?: string,
): Promise<string> {
  if (importSessionId) {
    const batch = await requestMobileJson(credentials, "/api/imports", {
      method: "POST", body: JSON.stringify({ clientSessionId: importSessionId, source: "share" }),
    });
    if (!isRecord(batch) || batch.id !== importSessionId) throw new ApiError("服务器批次结果无效。", 502);
  }
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
      body: JSON.stringify({ id, text, ...(importSessionId ? { importSessionId } : {}) }),
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

export async function fetchMobileCalendar(credentials: Credentials, params: Record<string, string>): Promise<import('../types').MobileCalendar> {
  const body = await requestMobileJson(credentials, `/api/mobile/v1/calendar?${new URLSearchParams(params)}`);
  if (!isRecord(body) || !isString(body.month, 7) || !isString(body.timezone, 100) || !Array.isArray(body.days) || body.days.length > 31 || !Array.isArray(body.entries) || body.entries.length > 30 || !isNullableString(body.nextCursor) || !Array.isArray(body.people) || !Array.isArray(body.ages)) throw new ApiError('日历数据无效。', 502);
  for (const day of body.days) if (!isRecord(day) || !isString(day.date, 10) || !Number.isSafeInteger(day.count) || (day.count as number) < 0 || !Array.isArray(day.covers) || day.covers.length > 3 || day.covers.some(c => !isRecord(c) || !isString(c.assetId, 128) || !isString(c.eventId, 128))) throw new ApiError('日历数据无效。', 502);
  for (const row of body.entries) if (!isRecord(row) || !isString(row.id, 128) || !isString(row.title) || !isDateTime(row.occurredAt) || !isString(row.date, 10)) throw new ApiError('日历数据无效。', 502);
  for (const row of body.people) if (!isRecord(row) || !isString(row.id, 128) || !isString(row.name, 100)) throw new ApiError('日历数据无效。', 502);
  for (const row of body.ages) if (!isRecord(row) || !isString(row.label, 100) || !isString(row.date, 10)) throw new ApiError('日历数据无效。', 502);
  return body as import('../types').MobileCalendar;
}

export async function fetchCollections(credentials:Credentials,deleted=false,cursor=''):Promise<import('../collections/types').CollectionPage>{
  const value=await requestMobileJson(credentials,`/api/collections?deleted=${deleted?'1':'0'}&cursor=${encodeURIComponent(cursor)}`);
  if(!isRecord(value)||!Array.isArray(value.entries)||!isNullableString(value.nextCursor)||typeof value.canWrite!=='boolean')throw new ApiError('相册数据无效。',502);
  return value as import('../collections/types').CollectionPage;
}
export async function fetchCollection(credentials:Credentials,id:string):Promise<import('../collections/types').CollectionDetail>{
  const value=await requestMobileJson(credentials,`/api/collections/${encodeURIComponent(id)}`);
  if(!isRecord(value)||!isString(value.title)||!Array.isArray(value.items)||!Array.isArray(value.sections)||!Number.isSafeInteger(value.revision))throw new ApiError('相册数据无效。',502);
  return value as import('../collections/types').CollectionDetail;
}
export async function createNativeCollection(credentials:Credentials,title:string,kind:'album'|'chapter'){
  const value=await requestMobileJson(credentials,'/api/collections',{method:'POST',body:JSON.stringify({title,kind})});
  if(!isRecord(value)||!isString(value.id,128))throw new ApiError('相册数据无效。',502);return value.id;
}
export async function mutateCollection(credentials:Credentials,id:string,input:Record<string,unknown>):Promise<import('../collections/types').CollectionDetail>{
  try{return await requestMobileJson(credentials,`/api/collections/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(input)}) as import('../collections/types').CollectionDetail;}
  catch(error){if(error instanceof ApiError && error.status===409)throw new ApiError('其他家人已修改相册。你的输入仍保留，请复制需要保留的内容后重新读取。',409);throw error;}
}

export async function fetchMediaDerivations(credentials: Credentials, assetId: string, kind?: import('../media/types').MediaDerivation['kind']): Promise<{jobs: import('../media/types').MediaDerivation[]; transcript: import('../media/types').ReaderTranscript|null}> {
  const body = await requestMobileJson(credentials, `/api/media/${encodeURIComponent(assetId)}/derivations`, kind ? {method:'POST',body:JSON.stringify({kind})}:{});
  if (!isRecord(body) || !Array.isArray(body.jobs) || !body.jobs.every(j=>isRecord(j)&&['preview','transcode','waveform'].includes(String(j.kind))&&['queued','running','succeeded','failed'].includes(String(j.status))&&isNullableString(j.outputAssetId,128)&&isNullableString(j.errorCode,200))) throw new ApiError('媒体处理信息无效。',502);
  const transcript=body.transcript;
  if(transcript!==null && (!isRecord(transcript)||!isString(transcript.text,2_000_000)||typeof transcript.edited!=='boolean'||!Array.isArray(transcript.segments)||!transcript.segments.every(s=>isRecord(s)&&typeof s.startSeconds==='number'&&Number.isFinite(s.startSeconds)&&s.startSeconds>=0&&typeof s.endSeconds==='number'&&Number.isFinite(s.endSeconds)&&s.endSeconds>s.startSeconds&&isString(s.text,10000)))) throw new ApiError('转录信息无效。',502);
  return body as unknown as {jobs: import('../media/types').MediaDerivation[]; transcript: import('../media/types').ReaderTranscript|null};
}

export async function fetchBooks(credentials: Credentials, deleted=false,cursor=''): Promise<import('../books/types').BookPage> {
  const value=await requestMobileJson(credentials,`/api/books/projects?deleted=${deleted?'1':'0'}&cursor=${encodeURIComponent(cursor)}`);
  if(!isRecord(value)||!Array.isArray(value.entries)||!hasCursor(value))throw new Error('书架响应无效');
  return value as import('../books/types').BookPage;
}
export async function fetchBook(credentials: Credentials,id:string):Promise<import('../books/types').BookDetail>{
  const value=await requestMobileJson(credentials,`/api/books/projects/${encodeURIComponent(id)}`);
  if(!isRecord(value)||!Array.isArray(value.chapters)||!Array.isArray(value.blocks)||!Array.isArray(value.sources)||!isRecord(value.sourceStates))throw new Error('作品响应无效');
  return value as import('../books/types').BookDetail;
}
export async function createNativeBook(credentials: Credentials,title:string,template:import('../books/types').BookTemplate,audience:import('../books/types').BookAudience):Promise<string>{
  const value=await requestMobileJson(credentials,'/api/books/projects',{method:'POST',body:JSON.stringify({title,template,audience})});
  if(!isRecord(value)||!isString(value.id,128))throw new Error('作品响应无效');return value.id;
}
export async function mutateBook(credentials:Credentials,id:string,input:Record<string,unknown>):Promise<import('../books/types').BookDetail>{
  try {return await requestMobileJson(credentials,`/api/books/projects/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(input)}) as import('../books/types').BookDetail;}
  catch(e){if(e instanceof ApiError&&e.status===409)throw new ApiError('其他家人已保存修改。你的输入仍保留，请复制需要的文字，再重新载入核对。',409);throw e;}
}
export type BookMaterials={entries:{id:string;title:string;kind:'memory'|'collection'|'story'}[];nextCursor:string|null};
export async function fetchBookMaterials(credentials:Credentials,kind:string,audience:string,cursor=''):Promise<BookMaterials>{
  const value=await requestMobileJson(credentials,`/api/books/projects/materials?${new URLSearchParams({kind,audience,cursor})}`);
  if(!isRecord(value)||!Array.isArray(value.entries)||!hasCursor(value))throw new Error('选材响应无效');return value as BookMaterials;
}

function parseBookRender(value: unknown): import('../books/render-types').BookRenderStatus {
  if (!isRecord(value) || !isString(value.id,128) || !isString(value.projectId,128)
      || !['pdf','epub','reading_zip'].includes(String(value.format))
      || !['family','personal'].includes(String(value.audience))
      || !['queued','running','succeeded','failed','cancelled'].includes(String(value.status))
      || typeof value.progress !== 'number' || !Number.isFinite(value.progress) || value.progress < 0 || value.progress > 100
      || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision)
      || !(value.bytes === null || typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes >= 0)
      || !isNullableString(value.errorCode,200) || typeof value.downloadable !== 'boolean')
    throw new ApiError('出版任务响应无效。',502);
  return value as unknown as import('../books/render-types').BookRenderStatus;
}
export async function fetchBookRenders(credentials: Credentials,id:string) {
  const value = await requestMobileJson(credentials,`/api/books/projects/${encodeURIComponent(id)}/renders`);
  if (!isRecord(value) || !Array.isArray(value.jobs)) throw new ApiError('出版列表响应无效。',502);
  return value.jobs.map(parseBookRender);
}
export async function startBookRender(credentials:Credentials,id:string,revision:number,format:import('../books/render-types').BookRenderStatus['format']) {
  return parseBookRender(await requestMobileJson(credentials,`/api/books/projects/${encodeURIComponent(id)}/renders`,{method:'POST',body:JSON.stringify({revision,format})}));
}
export async function changeBookRender(credentials:Credentials,id:string,operation:'retry'|'cancel'|'remove') {
  await requestMobileJson(credentials,`/api/books/renders/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({operation})});
}

export async function fetchBookReview(credentials:Credentials,params:Record<string,string>):Promise<import('../books/review-types').BookReview> {
  const value=await requestMobileJson(credentials,`/api/books/review?${new URLSearchParams(params)}`);
  if(!isRecord(value)||!Array.isArray(value.materials)||!Array.isArray(value.months)||typeof value.total!=="number"||!hasCursor(value))throw new ApiError("回顾响应无效。",502);
  return value as import('../books/review-types').BookReview;
}
export async function mutateBookReview(credentials:Credentials,input:Record<string,unknown>):Promise<{id?:string;existing?:boolean}> {
  return await requestMobileJson(credentials,"/api/books/review",{method:"POST",body:JSON.stringify(input)}) as {id?:string;existing?:boolean};
}


export function parseTranscriptReview(value: unknown): import("../transcripts/types").TranscriptReview {
  if (!isRecord(value) || !isString(value.assetId, 128) || typeof value.canEdit !== "boolean") throw new ApiError("转录信息无效。", 502);
  const row = value.transcript;
  if (row !== null && (!isRecord(row) || !isString(row.text, 2_000_000) || typeof row.edited !== "boolean" || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0 || !Array.isArray(row.segments) || row.segments.length > 5000 || (row.edited && row.segments.length !== 0) || !row.segments.every(s => isRecord(s) && typeof s.startSeconds === "number" && Number.isFinite(s.startSeconds) && s.startSeconds >= 0 && typeof s.endSeconds === "number" && Number.isFinite(s.endSeconds) && s.endSeconds > s.startSeconds && isString(s.text, 10000)))) throw new ApiError("转录信息无效。", 502);
  return value as unknown as import("../transcripts/types").TranscriptReview;
}
export async function fetchTranscriptReview(credentials: Credentials, assetId: string) {
  const result = parseTranscriptReview(await requestMobileJson(credentials, `/api/mobile/v1/transcripts/${encodeURIComponent(assetId)}`));
  if (result.assetId !== assetId) throw new ApiError("转录素材不匹配。", 502);
  return result;
}
export async function saveTranscriptReview(credentials: Credentials, assetId: string, text: string, revision: number | null) {
  const result = parseTranscriptReview(await requestMobileJson(credentials, `/api/mobile/v1/transcripts/${encodeURIComponent(assetId)}`, { method: "POST", body: JSON.stringify({ text, revision }) }));
  if (result.assetId !== assetId) throw new ApiError("转录素材不匹配。", 502);
  return result;
}


export function parseOrganizerReview(value: unknown): import("../ai/organizer-types").OrganizerReview {
  if (!isRecord(value) || !isRecord(value.target) || !["asset", "inbox_item", "memory_event"].includes(String(value.target.kind)) || !isString(value.target.id, 128) || !Array.isArray(value.tasks) || value.tasks.length > 10 || !Array.isArray(value.transcripts)) throw new ApiError("整理结果格式无效。", 502);
  parseAiSettings(value.settings);
  if (value.names !== null) {
    const names = parseNameReview(value.names);
    if (names.target.kind !== value.target.kind || names.target.id !== value.target.id) throw new ApiError("整理对象不匹配。", 502);
  }
  for (const task of value.tasks) {
    if (!isRecord(task) || !isString(task.id, 128) || !["waiting_analysis", "analyzing", "waiting_naming", "naming", "ready", "insufficient", "failed", "cancelled", "cancelling"].includes(String(task.state)) || !isString(task.message, 500) || ![task.active, task.canCancel, task.canRetry, task.canRegenerate].every(flag => typeof flag === "boolean") || !Array.isArray(task.steps) || task.steps.length > 21 || !task.steps.every(step => isRecord(step) && isString(step.label, 100) && ["pending", "running", "completed", "failed", "cancelled"].includes(String(step.status)))) throw new ApiError("整理步骤格式无效。", 502);
  }
  if (value.transcripts.length > 1000 || !value.transcripts.every(row => isRecord(row) && isString(row.assetId, 128) && isString(row.text, 2_000_000) && typeof row.edited === "boolean" && Number.isSafeInteger(row.revision) && Number(row.revision) >= 0)) throw new ApiError("转录格式无效。", 502);
  return value as unknown as import("../ai/organizer-types").OrganizerReview;
}
export async function fetchOrganizerReview(credentials: Credentials, target: import("../ai/organizer-types").OrganizerTarget) {
  const review = parseOrganizerReview(await requestMobileJson(credentials, `/api/mobile/v1/ai/organizer?${new URLSearchParams(target)}`));
  if (review.target.kind !== target.kind || review.target.id !== target.id) throw new ApiError("整理对象不匹配。", 502);
  return review;
}
export async function mutateOrganizerReview(credentials: Credentials, target: import("../ai/organizer-types").OrganizerTarget, operation: import("../ai/organizer-types").OrganizerOperation, jobId?: string) {
  const review = parseOrganizerReview(await requestMobileJson(credentials, "/api/mobile/v1/ai/organizer", { method: "POST", body: JSON.stringify({ ...target, operation, jobId }) }));
  if (review.target.kind !== target.kind || review.target.id !== target.id) throw new ApiError("整理对象不匹配。", 502);
  return review;
}
