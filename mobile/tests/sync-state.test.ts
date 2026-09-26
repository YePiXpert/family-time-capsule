import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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
vi.mock("expo-image-manipulator", () => ({}));
vi.mock("expo-video-thumbnails", () => ({}));
const syncDir = () => path.join(env.root, "anan-v1", "sync");
const put = (name: string, text: string) => {
  fs.mkdirSync(syncDir(), { recursive: true });
  fs.writeFileSync(path.join(syncDir(), name), text);
};
const KEY_ID = "0123456789abcdef";
beforeEach(() => {
  vi.resetModules();
  env.root = fs.mkdtempSync(path.join(os.tmpdir(), "anan-sync-state-"));
});
afterEach(() => {
  fs.rmSync(env.root, { recursive: true, force: true });
});
const load = () => import("../src/sync/state");
it("upgrades a Build 71 state on read: joined when it last backed up, auto-sync on, nothing seen yet", async () => {
  const state = await load();
  put(
    "state.json",
    JSON.stringify({
      version: 1,
      enabled: true,
      keyId: KEY_ID,
      lastBackupAt: "2026-09-20T10:00:00.000Z",
      lastBackupBytes: 4096,
      lastBackupObjects: 3,
      lastError: "网络不通",
    }),
  );
  expect(await state.readRemoteState("2026-09-21T00:00:00.000Z")).toEqual({
    version: 2,
    enabled: true,
    keyId: KEY_ID,
    joinedAt: "2026-09-20T10:00:00.000Z",
    autoSync: true,
    seen: {},
    lastSyncAt: "2026-09-20T10:00:00.000Z",
    lastSyncSummary: {
      devices: 1,
      objects: 3,
      bytes: 4096,
      pulled: 0,
      pushed: 0,
      conflicts: 0,
    },
    lastError: "网络不通",
  });
  // 关着、还没备份过的 v1：加入时刻只能算现在。
  put(
    "state.json",
    JSON.stringify({ version: 1, enabled: false, keyId: KEY_ID }),
  );
  expect(await state.readRemoteState("2026-09-21T00:00:00.000Z")).toEqual({
    version: 2,
    enabled: false,
    keyId: KEY_ID,
    joinedAt: "2026-09-21T00:00:00.000Z",
    autoSync: true,
    seen: {},
  });
});
it("round-trips a v2 state, tolerates missing optional fields and drops junk in seen", async () => {
  const state = await load();
  expect(await state.readRemoteState()).toBeNull();
  const fresh = state.freshRemoteState(KEY_ID, "2026-09-21T01:00:00.000Z");
  expect(fresh).toEqual({
    version: 2,
    enabled: true,
    keyId: KEY_ID,
    joinedAt: "2026-09-21T01:00:00.000Z",
    autoSync: true,
    seen: {},
  });
  const full = {
    ...fresh,
    autoSync: false,
    deviceId: "device-1",
    seen: { "device-1": "ab".repeat(32) },
    lastPush: { entitiesSha: "ab".repeat(32), manifestSha: "cd".repeat(32) },
    lastSyncAt: "2026-09-21T02:00:00.000Z",
    lastSyncSummary: {
      devices: 2,
      objects: 9,
      bytes: 1234,
      pulled: 3,
      pushed: 1,
      conflicts: 1,
    },
    lastError: "x",
  };
  state.writeRemoteState(full);
  expect(await state.readRemoteState()).toEqual(full);
  expect(fs.readdirSync(syncDir())).toEqual(["state.json"]);
  put(
    "state.json",
    JSON.stringify({
      version: 2,
      enabled: true,
      keyId: KEY_ID,
      seen: { ok: "sha", bad: 7 },
      joinedAt: "not a time",
      autoSync: "yes",
      deviceId: 7,
    }),
  );
  expect(await state.readRemoteState("2026-09-21T03:00:00.000Z")).toEqual({
    version: 2,
    enabled: true,
    keyId: KEY_ID,
    joinedAt: "2026-09-21T03:00:00.000Z",
    autoSync: true,
    seen: { ok: "sha" },
  });
  state.clearRemoteState();
  expect(await state.readRemoteState()).toBeNull();
  state.clearRemoteState();
});
it.each([
  {},
  { entitiesSha: "a".repeat(64) },
  { manifestSha: "b".repeat(64) },
  { entitiesSha: "a".repeat(63), manifestSha: "b".repeat(64) },
  { entitiesSha: "a".repeat(64), manifestSha: "b".repeat(65) },
  { entitiesSha: "A".repeat(64), manifestSha: "b".repeat(64) },
  { entitiesSha: "a".repeat(64), manifestSha: "g".repeat(64) },
  { entitiesSha: 123, manifestSha: "b".repeat(64) },
  null,
  "junk",
])("丢弃字段不完整或指纹不合法的 lastPush：%j", async (lastPush) => {
  const state = await load();
  const fresh = state.freshRemoteState(KEY_ID);
  put("state.json", JSON.stringify({ ...fresh, lastPush }));
  expect(await state.readRemoteState()).toEqual(fresh);
});
it("treats a corrupt, foreign-version or wrong-key state as not joined", async () => {
  const state = await load();
  for (const text of [
    "{not json",
    JSON.stringify({ version: 3, enabled: true, keyId: KEY_ID }),
    JSON.stringify({ version: 2, enabled: "yes", keyId: KEY_ID }),
    JSON.stringify({ version: 2, enabled: true, keyId: "short" }),
    JSON.stringify(null),
  ]) {
    put("state.json", text);
    expect(await state.readRemoteState()).toBeNull();
  }
});
it("writes through a .part file and never leaves one behind", async () => {
  const state = await load();
  put("state.json.part", "half written before a crash");
  state.writeRemoteState(state.freshRemoteState(KEY_ID));
  expect(fs.readdirSync(syncDir()).sort()).toEqual(["state.json"]);
  state.writeBase({ version: 1, merged: { records: { a: "t|h" } }, known: {} });
  state.writeConflicts([]);
  expect(fs.readdirSync(syncDir()).sort()).toEqual([
    "base.json",
    "conflicts.json",
    "state.json",
  ]);
});
it("reads the merge base back, drops malformed parts and caps known versions per entity", async () => {
  const state = await load();
  expect(await state.readBase()).toEqual({ version: 1, merged: {}, known: {} });
  const base = {
    version: 1 as const,
    merged: {
      records: { r1: "2026-09-21T00:00:00.000Z|" + "a".repeat(64) },
      root: { profile: "b".repeat(64) },
    },
    known: { "records:r1": ["x", "y"] },
  };
  state.writeBase(base);
  expect(await state.readBase()).toEqual(base);
  put(
    "base.json",
    JSON.stringify({
      version: 1,
      merged: { records: { ok: "fp" }, media: { bad: 1 }, junk: "x" },
      known: {
        "records:a": Array.from({ length: 40 }, (_, i) => `v${i}`),
        "records:b": ["fine", 3],
        "records:c": "not a list",
      },
    }),
  );
  const read = await state.readBase();
  expect(read.merged).toEqual({ records: { ok: "fp" } });
  expect(read.known["records:a"]).toHaveLength(state.KNOWN_LIMIT);
  expect(read.known["records:a"]![0]).toBe("v8");
  expect(read.known["records:b"]).toBeUndefined();
  expect(read.known["records:c"]).toBeUndefined();
  put("base.json", "{{{");
  expect(await state.readBase()).toEqual(state.emptyBase());
  put("base.json", JSON.stringify({ version: 2, merged: {}, known: {} }));
  expect(await state.readBase()).toEqual(state.emptyBase());
});
it("keeps conflicts with their losing version and skips entries it cannot trust", async () => {
  const state = await load();
  expect(await state.readConflicts()).toEqual([]);
  const loser = {
    id: "r1",
    revision: 3,
    updatedAt: "2026-09-21T00:00:00.000Z",
    title: "第一次笑",
    text: "妈妈写的版本",
    date: "2026-09-20T00:00:00.000Z",
    location: "",
    first: false,
    mediaIds: [],
    coverId: null,
    by: "妈妈",
  };
  const conflict = {
    key: "records:r1",
    kind: "records" as const,
    entityId: "r1",
    at: "2026-09-21T00:01:00.000Z",
    device: "妈妈的手机",
    winner: { updatedAt: "2026-09-21T00:00:30.000Z", by: "爸爸" },
    loser,
  };
  state.writeConflicts([conflict]);
  expect(await state.readConflicts()).toEqual([conflict]);
  put(
    "conflicts.json",
    JSON.stringify({
      version: 1,
      items: [
        conflict,
        { ...conflict, kind: "albums" },
        { ...conflict, loser: { ...loser, id: "other" } },
        { ...conflict, winner: {} },
        { ...conflict, device: 5 },
        "junk",
      ],
    }),
  );
  expect(await state.readConflicts()).toEqual([conflict]);
  put("conflicts.json", JSON.stringify({ version: 1, items: "no" }));
  expect(await state.readConflicts()).toEqual([]);
  put("conflicts.json", "broken");
  expect(await state.readConflicts()).toEqual([]);
});
it("clearSyncFiles removes state and base, keeps the conflict versions, and is idempotent", async () => {
  const state = await load();
  state.writeRemoteState(state.freshRemoteState(KEY_ID));
  state.writeBase(state.emptyBase());
  state.writeConflicts([]);
  state.clearSyncFiles();
  // 没选中的一版只存在这里：退出一起写后还要能「用这一版」。
  expect(fs.readdirSync(syncDir())).toEqual(["conflicts.json"]);
  state.clearSyncFiles();
  expect(await state.readRemoteState()).toBeNull();
  expect(await state.readBase()).toEqual(state.emptyBase());
  expect(await state.readConflicts()).toEqual([]);
});
it("notifies once after each completed write or clear, and stops after unsubscribe", async () => {
  const state = await load();
  const notify = vi.fn();
  const unsubscribe = state.subscribeSyncFiles(notify);
  state.writeRemoteState(state.freshRemoteState(KEY_ID));
  expect(notify).toHaveBeenCalledTimes(1);
  state.writeConflicts([]);
  expect(notify).toHaveBeenCalledTimes(2);
  state.clearSyncFiles();
  expect(notify).toHaveBeenCalledTimes(3);
  state.clearRemoteState();
  expect(notify).toHaveBeenCalledTimes(4);
  state.writeBase(state.emptyBase());
  expect(notify).toHaveBeenCalledTimes(5);
  unsubscribe();
  state.writeRemoteState(state.freshRemoteState(KEY_ID));
  state.writeConflicts([]);
  state.clearSyncFiles();
  expect(notify).toHaveBeenCalledTimes(5);
});
it("says how many phones were not read this time, and nothing when all were", async () => {
  const { unreadNotice } = await load();
  const summary = { devices: 3, objects: 1, bytes: 1, pulled: 0, pushed: 0, conflicts: 0 };
  expect(unreadNotice(undefined)).toBe("");
  expect(unreadNotice(summary)).toBe("");
  expect(unreadNotice({ ...summary, unread: 2 })).toContain("有 2 台手机的内容这次没读到");
});
