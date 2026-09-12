import { createElement, Fragment, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LocalTimelineEvent } from "../src/types";

const mocks = vi.hoisted(() => ({
  sync: vi.fn(), fetchMe: vi.fn(), submitOnboarding: vi.fn(),
  saveCredentials: vi.fn(), signOut: vi.fn(),
  events: [] as LocalTimelineEvent[], lastSyncAt: null as string | null,
}));

vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock("expo-network", () => ({ useNetworkState: () => ({ isConnected: true }), addNetworkStateListener: () => ({ remove() {} }) }));
vi.mock("expo-haptics", () => ({ notificationAsync: vi.fn(), selectionAsync: vi.fn(), impactAsync: vi.fn(), NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" }, ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" } }));
vi.mock("../src/memories/edit-sync", () => ({ syncMemoryEdits: async () => ({ saved: 0, needsAttention: 0 }) }));
vi.mock("../src/sync/sync", () => ({ syncArchive: mocks.sync }));
vi.mock("../src/storage/database", () => ({
  cacheMobileHome: vi.fn(), cacheMobileReview: vi.fn(), clearLocalArchive: vi.fn(),
  getCachedFamily: async () => null, getCachedMobileHome: async () => null, getCachedViewer: async () => null,
  getMeta: async (key: string) => key === "welcome_done" ? "1" : key === "last_sync_at" ? mocks.lastSyncAt : null,
  listCachedPeople: async () => [], listOutbox: async () => [], listTimeline: async () => structuredClone(mocks.events),
  removeOutboxItem: vi.fn(), setMeta: vi.fn(),
  getSyncConsent: async () => null, setSyncConsent: vi.fn(),
  getActiveDestination: async () => null, setActiveDestination: vi.fn(),
  clearServerCaches: vi.fn(), deleteLocalCaptureRecord: vi.fn(),
}));
vi.mock("../src/storage/files", () => ({ clearLocalFiles: vi.fn(), removeLocalFile: vi.fn() }));
vi.mock("../src/reading/native", () => ({ clearAllReadingDownloads: vi.fn(), revalidateReadingDownloads: async () => {} }));
vi.mock("../src/auth/credentials", () => ({ clearCredentials: vi.fn(), saveCredentials: mocks.saveCredentials }));
vi.mock("../src/api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, readonly status: number) { super(message); this.name = "ApiError"; }
  },
  fetchBootstrap: async (serverUrl: string) => ({ serverUrl, info: { instanceId: "instance-1" } }),
  fetchMobileHome: async () => null, fetchMobileReview: async () => null, signOut: mocks.signOut,
  fetchMe: mocks.fetchMe, submitOnboarding: mocks.submitOnboarding,
}));
vi.mock("../src/native/intake", () => ({ drainNativeShareIntake: async () => ({ manifests: 0 }) }));
vi.mock("../../mobile/modules/share-intake/src", () => ({ subscribeToPendingNativeShares: () => () => {} }));
vi.mock("../src/notifications/review-reminders", () => ({ reconcileWeeklyReviewReminder: async () => {} }));

const { AppProvider, useApp, useAppData, useAppActions, useSyncStatus } = await import("../src/state/AppContext");
const { ApiError } = await import("../src/api/client");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let app: ReturnType<typeof useApp>;
let data: ReturnType<typeof useAppData>;
let dataRenders = 0, actionRenders = 0, statusRenders = 0;
function DataProbe() { const current = useAppData(); useEffect(() => { data = current; dataRenders++; }); return null; }
function ActionsProbe() { useAppActions(); useEffect(() => { actionRenders++; }); return null; }
function StatusProbe() { useSyncStatus(); useEffect(() => { statusRenders++; }); return null; }
function Probe() {
  const current = useApp();
  useEffect(() => { app = current; }, [current]);
  return null;
}

let tree: ReactTestRenderer | undefined;
const credentials = { serverUrl: "https://example.test", token: "fictional-session", instanceId: "instance-1" };
const summary = { uploadedCount: 0, failedCount: 0, eventCount: 0 };

beforeEach(() => {
  mocks.events = [];
  mocks.lastSyncAt = null;
  dataRenders = actionRenders = statusRenders = 0;
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.sync.mockResolvedValue(summary);
  mocks.fetchMe.mockResolvedValue({
    status: "ready",
    user: { id: "user-1", displayName: "妈妈", email: "a@b.c" },
    account: { role: "admin", personId: null, isGuardian: true },
    family: { id: "family-1", name: "小满家", timezone: "Asia/Shanghai" },
  });
  mocks.submitOnboarding.mockImplementation(async () => {
    mocks.fetchMe.mockResolvedValue({ status: "ready", user: { id: "user-1" }, family: { id: "family-1" } });
  });
});
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
  vi.useRealTimers();
});

async function open(initial: typeof credentials | null = credentials) {
  await act(async () => {
    tree = create(createElement(AppProvider, { initialCredentials: initial },
      createElement(Fragment, null, createElement(Probe), createElement(DataProbe), createElement(ActionsProbe), createElement(StatusProbe))));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
}

it("账号待初始化时连接不触发注定失败的同步；建家庭后立即同步", async () => {
  mocks.fetchMe.mockResolvedValue({ status: "needsOnboarding", user: { id: "user-1", displayName: "妈妈", email: "a@b.c" }, account: { role: "admin" } });
  await open(null);
  await act(async () => { await app.connect(credentials); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(mocks.fetchMe).toHaveBeenCalled();
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(app.needsOnboarding).toBe(true);

  await act(async () => {
    await app.completeOnboarding({
      familyName: "小满家", timezone: "Asia/Shanghai", childDisplayName: "小满",
      childBirthDate: "2026-09-02", selfDisplayName: "妈妈", selfRelationToChild: "妈妈",
      selfIsGuardian: true,
    });
  });
  expect(mocks.submitOnboarding).toHaveBeenCalledOnce();
  expect(mocks.sync).toHaveBeenCalledOnce();
  expect(app.needsOnboarding).toBe(false);
});

it("同步返回 401 时用 /me 区分“待初始化”与“会话失效”", async () => {
  await open();
  expect(mocks.sync).toHaveBeenCalledOnce();

  // 会话仍在但账号未建家庭：不再误报“登录已过期”。
  mocks.sync.mockRejectedValueOnce(new ApiError("登录已过期，请重新登录。", 401));
  mocks.fetchMe.mockResolvedValue({
    status: "needsOnboarding",
    user: { id: "user-1", displayName: "妈妈", email: "a@b.c" },
    account: { role: "admin" },
  });
  await act(async () => { await app.runSync(); });
  expect(app.needsOnboarding).toBe(true);
  expect(app.message).toContain("完成家庭初始化");

  // 真正的会话失效保持原有提示。
  mocks.fetchMe.mockResolvedValue({
    status: "ready",
    user: { id: "user-1", displayName: "妈妈", email: "a@b.c" },
    account: { role: "admin", personId: null, isGuardian: true },
    family: { id: "family-1", name: "小满家", timezone: "Asia/Shanghai" },
  });
  mocks.sync.mockRejectedValueOnce(new ApiError("登录已过期，请重新登录。", 401));
  await act(async () => { await app.runSync(); });
  expect(app.message).toContain("登录已过期");
});

it("欢迎页状态从本机读取：已处理过则不再弹出", async () => {
  await open();
  expect(app.welcomeSeen).toBe(true);
});

it("background sync and identical SQLite snapshots leave archive readers and actions unchanged", async () => {
  const row = (id: string): LocalTimelineEvent => ({
    id, title: id, bodyText: "保留这段回忆", occurredAt: "2026-09-01T00:00:00.000Z", occurredAtPrecision: "exact",
    updatedAt: "2026-09-01T00:00:00.000Z", locationText: null, childPersonId: null, ageDays: null, ageLabel: null,
    assetCount: 0, participantNames: [], captureIds: [], cover: null, localCoverUri: null, source: "server", syncState: null,
  });
  mocks.events = [row("first"), row("second")];
  await open();
  const initialData = data!, initialCounts = { dataRenders, actionRenders, statusRenders };
  await act(async () => { app.dismissMessage(); });
  mocks.lastSyncAt = "2026-09-12T00:00:00.000Z";
  await act(async () => { await app.reloadLocal(); await app.runSync(); });
  expect(data!).toBe(initialData);
  expect(dataRenders).toBe(initialCounts.dataRenders);
  expect(actionRenders).toBe(initialCounts.actionRenders);
  expect(statusRenders).toBeGreaterThan(initialCounts.statusRenders);

  // A new record and an edited record still publish, while the existing first
  // card retains its identity despite moving down after insertion.
  mocks.events = [row("new"), mocks.events[0]!, { ...mocks.events[1]!, title: "家人补充了这段回忆" }];
  await act(async () => { await app.reloadLocal(); });
  expect(data!.events.map(event => event.id)).toEqual(["new", "first", "second"]);
  expect(data!.events[1]).toBe(initialData.events[0]);
  expect(data!.events[2]).not.toBe(initialData.events[1]);
  expect(data!.events[2]?.title).toBe("家人补充了这段回忆");
  expect(actionRenders).toBe(initialCounts.actionRenders);
});
