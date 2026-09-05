import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  sync: vi.fn(), clearReading: vi.fn(), clearArchive: vi.fn(), clearFiles: vi.fn(), clearCredentials: vi.fn(),
}));
vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock("expo-network", () => ({ useNetworkState: () => ({ isConnected: false }), addNetworkStateListener: () => ({ remove() {} }) }));
vi.mock("../src/sync/sync", () => ({ syncArchive: mocks.sync }));
vi.mock("../src/storage/database", () => ({
  cacheMobileHome: vi.fn(), cacheMobileReview: vi.fn(), clearLocalArchive: mocks.clearArchive,
  getCachedFamily: async () => null, getCachedMobileHome: async () => null, getCachedViewer: async () => null,
  getMeta: async () => null, listCachedPeople: async () => [], listOutbox: async () => [], listTimeline: async () => [],
  removeOutboxItem: vi.fn(),
}));
vi.mock("../src/storage/files", () => ({ clearLocalFiles: mocks.clearFiles, removeLocalFile: vi.fn() }));
vi.mock("../src/reading/native", () => ({ clearAllReadingDownloads: mocks.clearReading, revalidateReadingDownloads: async () => {} }));
vi.mock("../src/auth/credentials", () => ({ clearCredentials: mocks.clearCredentials, saveCredentials: vi.fn() }));
vi.mock("../src/api/client", () => ({ fetchMobileHome: async () => null, fetchMobileReview: async () => null, signOut: async () => {} }));
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
const credentials = { serverUrl: "https://example.test", token: "fictional-session" };
const summary = { uploadedCount: 0, failedCount: 0, eventCount: 0 };
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); mocks.sync.mockResolvedValue(summary); });
afterEach(async () => { if (tree) await act(() => tree!.unmount()); tree = undefined; vi.useRealTimers(); });
async function open() {
  await act(async () => { tree = create(createElement(AppProvider, { initialCredentials: credentials }, createElement(Probe))); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
}
it("waits for existing sync writes and blocks new sync until all device stores have been cleared", async () => {
  let finish!: (value: typeof summary) => void;
  mocks.sync.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await open();
  expect(mocks.sync).toHaveBeenCalledOnce();
  let cleared!: Promise<void>;
  await act(async () => { cleared = app.clearLocal(); });
  expect(mocks.clearReading).not.toHaveBeenCalled();
  expect(mocks.clearArchive).not.toHaveBeenCalled();
  await act(async () => { await app.runSync(); });
  expect(mocks.sync).toHaveBeenCalledOnce();
  await act(async () => { finish(summary); await cleared; });
  expect(mocks.clearReading).toHaveBeenCalledOnce();
  expect(mocks.clearArchive).toHaveBeenCalledOnce();
  expect(mocks.clearFiles).toHaveBeenCalledOnce();
  expect(mocks.clearCredentials).toHaveBeenCalledOnce();
  expect(app.credentials).toBeNull();
  expect(app.message).toBe("本机资料已清除。");
});
it("reports an incomplete erasure and retains the connection for retry when reading cleanup fails", async () => {
  await open();
  mocks.clearReading.mockRejectedValueOnce(new Error("磁盘不可用"));
  await act(async () => { await app.clearLocal(); });
  expect(mocks.clearCredentials).not.toHaveBeenCalled();
  expect(app.credentials).toEqual(credentials);
  expect(app.message).toBe("清理未完成：磁盘不可用");
  await act(async () => { await app.clearLocal(); });
  expect(app.message).toBe("本机资料已清除。");
});
