import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
vi.mock("expo-image-manipulator", () => ({}));
vi.mock("expo-video-thumbnails", () => ({}));
const env = vi.hoisted(() => ({
  root: "",
  free: Number.POSITIVE_INFINITY,
  rejectActivation: false,
}));
vi.mock("expo-file-system", async () =>
  (await import("./helpers/expo-file-system-fake")).createExpoFileSystemFake(
    env,
  ),
);
// state.ts 经 crypto.ts 碰到 expo-crypto，它会拉起 react-native：这里只要随机字节。
vi.mock("expo-crypto", async () => {
  const { randomBytes, randomUUID } = await import("node:crypto");
  return {
    randomUUID,
    getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)),
  };
});
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked",
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));

beforeEach(() => {
  vi.resetModules();
  env.root = fs.mkdtempSync(path.join(os.tmpdir(), "anan-sync-status-"));
});
afterEach(() => { fs.rmSync(env.root, { recursive: true, force: true }); });
it("没有状态文件时未加入、无冲突", async () => {
  const status = await import("../src/sync/status");
  expect(await status.readSyncStatus()).toEqual({ joined: false, conflicts: 0 });
});
it("从真实状态文件读加入、同步时间、错误与两条留底", async () => {
  const state = await import("../src/sync/state");
  const status = await import("../src/sync/status");
  const at = "2026-09-21T10:00:00.000Z";
  state.writeRemoteState({ ...state.freshRemoteState("a".repeat(16)), lastSyncAt: at, lastError: "离线" });
  state.writeConflicts(["r1", "r2"].map((id) => ({
    key: `records:${id}`, kind: "records", entityId: id, at, device: null,
    winner: { updatedAt: at },
    loser: { id, revision: 1, updatedAt: at, title: "", text: "记下来", date: at, location: "", first: false, mediaIds: [], coverId: null },
  })));
  expect(await status.readSyncStatus()).toEqual({ joined: true, lastSyncAt: at, lastError: "离线", conflicts: 2 });
});
it("运行状态只有变化才通知，退订后不再通知", async () => {
  const status = await import("../src/sync/status");
  const listener = vi.fn();
  const unsubscribe = status.subscribeSyncRunning(listener);
  expect(status.isSyncRunning()).toBe(false);
  status.markSyncRunning(true);
  expect(status.isSyncRunning()).toBe(true);
  expect(listener).toHaveBeenCalledTimes(1);
  status.markSyncRunning(true);
  expect(listener).toHaveBeenCalledTimes(1);
  status.markSyncRunning(false);
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
  status.markSyncRunning(true);
  expect(listener).toHaveBeenCalledTimes(2);
});
it("claimSync 查空闲与占住一步完成：第二个来的拿不到，释放后才能再占", async () => {
  const status = await import("../src/sync/status");
  status.markSyncRunning(false);
  expect(status.claimSync()).toBe(true);
  expect(status.isSyncRunning()).toBe(true);
  expect(status.claimSync()).toBe(false);
  status.markSyncRunning(false);
  expect(status.claimSync()).toBe(true);
  status.markSyncRunning(false);
});
it("读文件失败当空，另一份能读的文件仍可用", async () => {
  const state = await import("../src/sync/state");
  const status = await import("../src/sync/status");
  vi.spyOn(state, "readRemoteState").mockRejectedValueOnce(new Error("read failed"));
  vi.spyOn(state, "readConflicts").mockRejectedValueOnce(new Error("read failed"));
  expect(await status.readSyncStatus()).toEqual({ joined: false, conflicts: 0 });
});
it("本机忙碌标志独立于同步状态，不发通知", async () => {
  const status = await import("../src/sync/status");
  const listener = vi.fn();
  const unsubscribe = status.subscribeSyncRunning(listener);
  expect(status.isLocalBusy()).toBe(false);
  status.markLocalBusy(true);
  expect(status.isLocalBusy()).toBe(true);
  expect(status.isSyncRunning()).toBe(false);
  status.markLocalBusy(false);
  expect(status.isLocalBusy()).toBe(false);
  expect(listener).not.toHaveBeenCalled();
  unsubscribe();
});
