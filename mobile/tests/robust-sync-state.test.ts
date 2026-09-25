/**
 * Robustness audit (isolated copy): sync/state.ts writeJson replaces a file by
 * deleting it first and then renaming the .part into place. If the process dies
 * (or moveSync throws) between the two steps, the only complete copy is the
 * .part, and every reader ignores it.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const env = vi.hoisted(() => ({
  root: "",
  free: Number.POSITIVE_INFINITY,
  rejectActivation: false,
  killNextMoveSync: false,
}));
vi.mock("expo-file-system", async () => {
  const fake = (await import("./helpers/expo-file-system-fake")).createExpoFileSystemFake(env);
  const moveSync = fake.File.prototype.moveSync;
  // Simulates the app being killed right after `file.delete()` and before the rename lands.
  fake.File.prototype.moveSync = function (this: unknown, to: unknown) {
    if (env.killNextMoveSync) {
      env.killNextMoveSync = false;
      throw new Error("process killed");
    }
    return moveSync.call(this, to as never);
  };
  return fake;
});
vi.mock("expo-crypto", async () => {
  const { randomBytes, randomUUID } = await import("node:crypto");
  return { randomUUID, getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)) };
});
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked",
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
vi.mock("expo-image-manipulator", () => ({}));
vi.mock("expo-video-thumbnails", () => ({}));
beforeEach(() => {
  vi.resetModules();
  env.killNextMoveSync = false;
  env.root = fs.mkdtempSync(path.join(os.tmpdir(), "anan-robust-state-"));
});
afterEach(() => {
  fs.rmSync(env.root, { recursive: true, force: true });
});
const conflict = (id: string, text: string) => ({
  key: `records:${id}`,
  kind: "records" as const,
  entityId: id,
  at: "2026-09-21T00:01:00.000Z",
  device: "妈妈的手机",
  winner: { updatedAt: "2026-09-21T00:00:30.000Z", by: "爸爸" },
  loser: {
    id,
    revision: 3,
    updatedAt: "2026-09-21T00:00:00.000Z",
    title: "第一次笑",
    text,
    date: "2026-09-20T00:00:00.000Z",
    location: "",
    first: false,
    mediaIds: [],
    coverId: null,
    by: "妈妈",
  },
});
it("keeps the losing versions when a conflicts.json rewrite is interrupted after the old file was deleted", async () => {
  const state = await import("../src/sync/state");
  const first = conflict("r1", "妈妈写的版本——只存在这里");
  state.writeConflicts([first]);
  // Next sync appends one more conflict; the process dies between delete and rename.
  env.killNextMoveSync = true;
  expect(() => state.writeConflicts([first, conflict("r2", "第二段")])).toThrow("process killed");
  // The complete new list is sitting in conflicts.json.part ...
  const part = path.join(env.root, "anan-v1", "sync", "conflicts.json.part");
  expect(JSON.parse(fs.readFileSync(part, "utf8")).items).toHaveLength(2);
  // ... but after restart the reader sees no conflicts at all: the only copy of the
  // losing text is gone from the UI (and the next writeConflicts deletes the .part).
  vi.resetModules();
  const restarted = await import("../src/sync/state");
  expect((await restarted.readConflicts()).map((c) => c.entityId)).toEqual(["r1", "r2"]);
});
it("stays joined when a state.json rewrite is interrupted after the old file was deleted", async () => {
  const state = await import("../src/sync/state");
  state.writeRemoteState(state.freshRemoteState("0123456789abcdef"));
  env.killNextMoveSync = true;
  expect(() =>
    state.writeRemoteState({ ...state.freshRemoteState("0123456789abcdef"), lastError: "x" }),
  ).toThrow("process killed");
  vi.resetModules();
  const restarted = await import("../src/sync/state");
  // Today this is null: the phone silently thinks it never joined (sync card offers
  // "开始第一次同步", auto-sync stops) although key and token are still in the keychain.
  expect((await restarted.readRemoteState())?.enabled).toBe(true);
});
