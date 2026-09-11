import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  consent: null as null | Record<string, unknown>,
  activeDest: null as string | null,
  outboxItems: [] as Record<string, unknown>[],
}));

const mocks = vi.hoisted(() => ({
  sync: vi.fn(),
  bootstrap: vi.fn(),
  clearCredentials: vi.fn(),
  fetchMe: vi.fn(),
  submitOnboarding: vi.fn(),
  saveCredentials: vi.fn(),
  signOut: vi.fn(),
  clearServerCaches: vi.fn(),
  setConsent: vi.fn(),
  setActiveDest: vi.fn(),
}));

vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock("expo-network", () => ({ useNetworkState: () => ({ isConnected: true }), addNetworkStateListener: () => ({ remove() {} }) }));
vi.mock("expo-haptics", () => ({ notificationAsync: vi.fn(), selectionAsync: vi.fn(), impactAsync: vi.fn(), NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" }, ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" } }));
vi.mock("../src/sync/sync", () => ({ syncArchive: mocks.sync }));
vi.mock("../src/storage/database", () => ({
  cacheMobileHome: vi.fn(), cacheMobileReview: vi.fn(), clearLocalArchive: vi.fn(),
  clearServerCaches: mocks.clearServerCaches,
  getActiveDestination: async () => state.activeDest,
  setActiveDestination: async (destination: string) => { state.activeDest = destination; mocks.setActiveDest(destination); },
  getCachedFamily: async () => null, getCachedMobileHome: async () => null, getCachedViewer: async () => null,
  getMeta: async (key: string) => (key === "welcome_done" ? "1" : null),
  getSyncConsent: async () => state.consent,
  setSyncConsent: async (consent: Record<string, unknown>) => {
    state.consent = consent;
    mocks.setConsent(consent);
  },
  listCachedPeople: async () => [],
  listOutbox: async () => state.outboxItems,
  listTimeline: async () => [],
  removeOutboxItem: vi.fn(), setMeta: vi.fn(),
  deleteLocalCaptureRecord: vi.fn(),
}));
vi.mock("../src/storage/files", () => ({ clearLocalFiles: vi.fn(), removeLocalFile: vi.fn() }));
vi.mock("../src/reading/native", () => ({ clearAllReadingDownloads: vi.fn(), revalidateReadingDownloads: async () => {} }));
vi.mock("../src/auth/credentials", () => ({ clearCredentials: mocks.clearCredentials, saveCredentials: mocks.saveCredentials }));
vi.mock("../src/api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, readonly status: number) { super(message); this.name = "ApiError"; }
  },
  fetchBootstrap: mocks.bootstrap,
  fetchMobileHome: async () => null, fetchMobileReview: async () => null, signOut: mocks.signOut,
  fetchMe: mocks.fetchMe, submitOnboarding: mocks.submitOnboarding,
}));
vi.mock("../src/native/intake", () => ({ drainNativeShareIntake: async () => ({ manifests: 0 }) }));
vi.mock("../../mobile/modules/share-intake/src", () => ({ subscribeToPendingNativeShares: () => () => {} }));
vi.mock("../src/notifications/review-reminders", () => ({ reconcileWeeklyReviewReminder: async () => {} }));

const { AppProvider, useApp } = await import("../src/state/AppContext");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let app: ReturnType<typeof useApp>;
function Probe() {
  const current = useApp();
  useEffect(() => { app = current; }, [current]);
  return null;
}

let tree: ReactTestRenderer | undefined;
const summary = { uploadedCount: 0, failedCount: 0, eventCount: 0, skippedUploadCount: 0 };
const ME_READY = {
  status: "ready",
  user: { id: "user-1", displayName: "妈妈", email: "a@b.c" },
  account: { role: "admin", personId: null, isGuardian: true },
  family: { id: "family-1", name: "小满家", timezone: "Asia/Shanghai" },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  state.consent = null;
  state.activeDest = null;
  state.outboxItems = [];
  mocks.bootstrap.mockImplementation(async (serverUrl: string) => ({ serverUrl, info: { instanceId: "instance-1" } }));
  mocks.sync.mockResolvedValue(summary);
  mocks.fetchMe.mockResolvedValue(ME_READY);
});
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
  vi.useRealTimers();
});

async function open(initial: { serverUrl: string; token: string; instanceId?: string } | null = null) {
  await act(async () => {
    tree = create(createElement(AppProvider, { initialCredentials: initial }, createElement(Probe)));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
}

describe("首次同步授权（M4）", () => {
  it("未授权时上传门关闭：有待传记录弹出授权门，同步不触发上传", async () => {
    state.outboxItems = [{ id: "cap-1", kind: "text_capture", payload: { text: "一句话" }, createdAt: "2026-09-06T00:00:00.000Z", attemptCount: 0, lastError: null }];
    await open({ serverUrl: "https://a.example", token: "t" });
    expect(app.awaitingSyncConsent).toBe(true);
    expect(app.syncConsent).toBeNull();

    // 手动同步也只下载、不上传：authorizeUpload 对所有项返回 false
    await act(async () => { await app.runSync(); });
    const authorize = mocks.sync.mock.calls[0]![1] as { authorizeUpload: (item: { id: string }) => Promise<boolean> };
    expect(await authorize.authorizeUpload({ id: "cap-1" })).toBe(false);
  });

  it("同意全部后授权门关闭，上传放行且不再弹出", async () => {
    state.outboxItems = [{ id: "cap-1", kind: "text_capture", payload: { text: "一句话" }, createdAt: "2026-09-06T00:00:00.000Z", attemptCount: 0, lastError: null }];
    await open({ serverUrl: "https://a.example", token: "t" });
    await act(async () => { await app.grantSyncConsent("all"); });
    expect(app.awaitingSyncConsent).toBe(false);
    expect(app.syncConsent?.scope).toBe("all");
    const lastCall = mocks.sync.mock.calls.at(-1)![1] as { authorizeUpload: (item: { id: string }) => Promise<boolean> };
    expect(await lastCall.authorizeUpload({ id: "cap-1" })).toBe(true);
    expect(await lastCall.authorizeUpload({ id: "cap-other" })).toBe(true);
  });

  it("选择部分时只放行所选记录", async () => {
    state.outboxItems = [
      { id: "cap-1", kind: "text_capture", payload: { text: "一" }, createdAt: "2026-09-06T00:00:00.000Z", attemptCount: 0, lastError: null },
      { id: "cap-2", kind: "text_capture", payload: { text: "二" }, createdAt: "2026-09-06T00:01:00.000Z", attemptCount: 0, lastError: null },
    ];
    await open({ serverUrl: "https://a.example", token: "t" });
    await act(async () => { await app.grantSyncConsent("selected", ["cap-1"]); });
    const lastCall = mocks.sync.mock.calls.at(-1)![1] as { authorizeUpload: (item: { id: string }) => Promise<boolean> };
    expect(await lastCall.authorizeUpload({ id: "cap-1" })).toBe(true);
    expect(await lastCall.authorizeUpload({ id: "cap-2" })).toBe(false);
  });

  it("切换目的地时清空服务器缓存并要求重新授权", async () => {
    state.activeDest = "https://a.example|user-1";
    await open(null);
    await act(async () => { await app.connect({ serverUrl: "https://b.example", token: "t2" }); });
    expect(mocks.clearServerCaches).toHaveBeenCalledOnce();
    expect(mocks.setActiveDest).toHaveBeenLastCalledWith(JSON.stringify(["https://b.example", "instance-1", "user-1", "family-1"]));
    // 旧目的地没有授权：即使曾有 A 的同意也不放行
    state.consent = { serverUrl: "https://a.example", userId: "user-1", familyId: "family-1", scope: "all", ids: [], decidedAt: "2026-09-06T00:00:00.000Z" };
    await act(async () => { await app.runSync(); });
    const lastCall = mocks.sync.mock.calls.at(-1)![1] as { authorizeUpload: (item: { id: string }) => Promise<boolean> };
    expect(await lastCall.authorizeUpload({ id: "cap-1" })).toBe(false);
  });
});

const verifiedCredentials = { serverUrl: "https://a.example", token: "t", instanceId: "instance-1" };
const capture = { id: "cap-1", kind: "text_capture", payload: { text: "不可替代的本机文字" }, createdAt: "2026-09-06T00:00:00.000Z", attemptCount: 0, lastError: null };
const consent = { ...verifiedCredentials, userId: "user-1", familyId: "family-1", scope: "all", ids: [], decidedAt: "2026-09-06T00:00:00.000Z" };

it("upgrades legacy credentials only after bootstrap and requires new instance-bound consent", async () => {
  state.outboxItems = [capture];
  state.consent = { ...consent, instanceId: undefined };
  await open({ serverUrl: "https://a.example", token: "t" });
  expect(mocks.saveCredentials).toHaveBeenCalledWith(verifiedCredentials);
  expect(app.credentials).toEqual(verifiedCredentials);
  expect(mocks.sync).toHaveBeenCalledOnce();
  expect(app.awaitingSyncConsent).toBe(true);
  expect(await mocks.sync.mock.calls[0]![1].authorizeUpload(capture)).toBe(false);
  await act(async () => { await app.grantSyncConsent("all"); });
  expect(mocks.setConsent).toHaveBeenCalledWith(expect.objectContaining({ instanceId: "instance-1", familyId: "family-1" }));
  expect(await mocks.sync.mock.calls.at(-1)![1].authorizeUpload(capture)).toBe(true);
});

it("verifies instance before sending the account token or uploading, and disconnects a replaced server", async () => {
  state.outboxItems = [capture]; state.consent = consent;
  mocks.bootstrap.mockResolvedValue({ serverUrl: verifiedCredentials.serverUrl, info: { instanceId: "replacement" } });
  await open(verifiedCredentials);
  expect(mocks.fetchMe).not.toHaveBeenCalled();
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.clearCredentials).toHaveBeenCalledOnce();
  expect(mocks.clearServerCaches).toHaveBeenCalledOnce();
  expect(app.credentials).toBeNull();
  expect(app.outbox).toEqual([capture]);
  expect(app.message).toContain("服务器实例已变化");
});

it("preserves the connection and local originals when bootstrap is offline without transmitting a token", async () => {
  state.outboxItems = [capture];
  mocks.bootstrap.mockRejectedValue(new Error("离线"));
  await open(verifiedCredentials);
  expect(app.credentials).toEqual(verifiedCredentials);
  expect(app.outbox).toEqual([capture]);
  expect(mocks.fetchMe).not.toHaveBeenCalled();
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.clearServerCaches).not.toHaveBeenCalled();
  expect(mocks.clearCredentials).not.toHaveBeenCalled();
});

it("rechecks family on every sync and never carries consent to another family on the same account", async () => {
  state.outboxItems = [capture]; state.consent = consent;
  await open(verifiedCredentials);
  expect(app.awaitingSyncConsent).toBe(false);
  expect(await mocks.sync.mock.calls[0]![1].authorizeUpload(capture)).toBe(true);
  mocks.fetchMe.mockResolvedValue({ ...ME_READY, family: { ...ME_READY.family, id: "family-2" } });
  await act(async () => { await app.runSync(); });
  expect(app.awaitingSyncConsent).toBe(true);
  expect(await mocks.sync.mock.calls.at(-1)![1].authorizeUpload(capture)).toBe(false);
  expect(mocks.setActiveDest).toHaveBeenLastCalledWith(JSON.stringify([verifiedCredentials.serverUrl, "instance-1", "user-1", "family-2"]));
});

it("drains the old synchronization before clearing caches or activating a new connection", async () => {
  let finish!: (value: typeof summary) => void;
  mocks.sync.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await open(verifiedCredentials);
  const oldOptions = mocks.sync.mock.calls[0]![1];
  mocks.clearServerCaches.mockClear(); mocks.saveCredentials.mockClear();
  let connected!: Promise<void>;
  await act(async () => { connected = app.connect({ serverUrl: "https://b.example", token: "b" }); });
  expect(oldOptions.isCurrent()).toBe(false);
  expect(await oldOptions.authorizeUpload(capture)).toBe(false);
  expect(mocks.clearServerCaches).not.toHaveBeenCalled();
  expect(mocks.saveCredentials).not.toHaveBeenCalled();
  await act(async () => { finish(summary); await connected; });
  expect(mocks.clearServerCaches).toHaveBeenCalledOnce();
  expect(app.credentials?.serverUrl).toBe("https://b.example");
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(mocks.sync.mock.calls.at(-1)![0].serverUrl).toBe("https://b.example");
});

it("rejects overlapping connection operations and fails closed after a credential write error", async () => {
  await open(verifiedCredentials);
  let finish!: (value: unknown) => void;
  mocks.bootstrap.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  let connected!: Promise<void>;
  await act(async () => { connected = app.connect({ serverUrl: "https://b.example", token: "b" }); });
  await act(async () => { await expect(app.disconnect()).rejects.toThrow("正在完成"); });
  await act(async () => { await app.clearLocal(); });
  expect(mocks.clearCredentials).not.toHaveBeenCalled();
  mocks.saveCredentials.mockRejectedValueOnce(new Error("密钥存储不可用"));
  await act(async () => {
    finish({ serverUrl: "https://b.example", info: { instanceId: "instance-2" } });
    await expect(connected).rejects.toThrow("密钥存储不可用");
  });
  expect(app.credentials).toBeNull();
  expect(mocks.clearCredentials).toHaveBeenCalledOnce();
});

it("discards an account response arriving after disconnect", async () => {
  await open(verifiedCredentials);
  let finish!: (value: typeof ME_READY) => void;
  mocks.fetchMe.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  let syncing!: Promise<void>, disconnected!: Promise<void>;
  await act(async () => { syncing = app.runSync(); });
  await act(async () => { disconnected = app.disconnect(); });
  await act(async () => { finish(ME_READY); await syncing; await disconnected; });
  expect(app.credentials).toBeNull();
  expect(app.userId).toBeNull();
  expect(mocks.sync).toHaveBeenCalledOnce();
});

it("revocation prevents upload and clears server caches", async () => {
  await open(verifiedCredentials);
  mocks.clearServerCaches.mockClear();
  mocks.fetchMe.mockResolvedValue({ status: "revoked" });
  await act(async () => { await app.runSync(); });
  expect(mocks.sync).toHaveBeenCalledOnce();
  expect(mocks.clearServerCaches).toHaveBeenCalledOnce();
  expect(app.userId).toBeNull();
  expect(app.message).toContain("授权已撤回");
});
