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
vi.mock("../src/sync/sync", () => ({ syncArchive: mocks.sync }));
vi.mock("../src/storage/database", () => ({
  cacheMobileHome: vi.fn(), cacheMobileReview: vi.fn(), clearLocalArchive: vi.fn(),
  clearServerCaches: mocks.clearServerCaches,
  getActiveDestination: async () => state.activeDest,
  setActiveDestination: mocks.setActiveDest,
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
vi.mock("../src/auth/credentials", () => ({ clearCredentials: vi.fn(), saveCredentials: mocks.saveCredentials }));
vi.mock("../src/api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, readonly status: number) { super(message); this.name = "ApiError"; }
  },
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
  vi.clearAllMocks();
  vi.useFakeTimers();
  state.consent = null;
  state.activeDest = null;
  state.outboxItems = [];
  mocks.sync.mockResolvedValue(summary);
  mocks.fetchMe.mockResolvedValue(ME_READY);
});
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
  vi.useRealTimers();
});

async function open(initial: { serverUrl: string; token: string } | null = null) {
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
    expect(mocks.setActiveDest).toHaveBeenLastCalledWith("https://b.example|user-1");
    // 旧目的地没有授权：即使曾有 A 的同意也不放行
    state.consent = { serverUrl: "https://a.example", userId: "user-1", familyId: "family-1", scope: "all", ids: [], decidedAt: "2026-09-06T00:00:00.000Z" };
    await act(async () => { await app.runSync(); });
    const lastCall = mocks.sync.mock.calls.at(-1)![1] as { authorizeUpload: (item: { id: string }) => Promise<boolean> };
    expect(await lastCall.authorizeUpload({ id: "cap-1" })).toBe(false);
  });
});
