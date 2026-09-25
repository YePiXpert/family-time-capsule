import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  type RemoteDeviceManifest,
  type Transport,
} from "../src/sync/transport";
import {
  keyIdOf,
  sha256Hex,
} from "../src/sync/crypto";
const env = vi.hoisted(() => ({
  root: "",
  free: Number.POSITIVE_INFINITY,
  rejectActivation: false,
  database: null as DatabaseSync | null,
  fullOn: "",
}));
vi.mock("expo-file-system", async () => {
  const fake = (await import("./helpers/expo-file-system-fake")).createExpoFileSystemFake(env);
  const write = fake.File.prototype.write;
  fake.File.prototype.write = function (this: { uri: string }, value: never) {
    if (env.fullOn && this.uri.endsWith(env.fullOn)) {
      env.fullOn = "";
      throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
    }
    return write.call(this, value);
  };
  return fake;
});
vi.mock("expo-sqlite", async () =>
  (await import("./helpers/expo-sqlite-fake")).createExpoSqliteFake(env),
);
vi.mock("expo-crypto", () => ({
  randomUUID,
  getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)),
}));
vi.mock("expo-sharing", () => ({
  isAvailableAsync: async () => true,
  shareAsync: async () => {},
}));
vi.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  manipulateAsync: async () => {
    const p = path.join(env.root, "cache-thumb.jpg");
    fs.writeFileSync(p, "thumb-bytes");
    return { uri: p, width: 512, height: 384 };
  },
}));
vi.mock("expo-video-thumbnails", () => ({
  getThumbnailAsync: async () => ({ uri: "", width: 0, height: 0 }),
}));
vi.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked",
    getItemAsync: async (key: string) =>
      store.get(`${env.root}:${key}`) ?? null,
    setItemAsync: async (key: string, value: string) => {
      store.set(`${env.root}:${key}`, value);
    },
    deleteItemAsync: async (key: string) => {
      store.delete(`${env.root}:${key}`);
    },
  };
});
/** 一家多台手机：对象共用，每台设备只改自己的清单，回收护住全家引用。 */
function fakeRemote() {
  const objects = new Map<string, Uint8Array>();
  const manifests = new Map<string, RemoteDeviceManifest>();
  const refs = new Map<string, readonly string[] | undefined>();
  const log: string[] = [];
  const client = (deviceId: string, memberId = deviceId): Transport => ({
    async me() {
      return { deviceId };
    },
    async status() {
      const latest = [...manifests.values()].at(-1);
      return {
        keyId: latest?.keyId ?? null,
        manifestUpdatedAt: latest?.updatedAt ?? null,
        manifests: manifests.size,
        objects: objects.size,
        bytes: [...objects.values()].reduce((n, b) => n + b.length, 0),
        limitBytes: 1024 ** 3,
        freeBytes: 1024 ** 3,
      };
    },
    async missing(ids) {
      return new Set(ids.filter((id) => !objects.has(id)));
    },
    async put(id, bytes, hash) {
      expect(sha256Hex(bytes)).toBe(hash);
      log.push(`put ${id}`);
      const created = !objects.has(id);
      objects.set(id, bytes);
      return { created };
    },
    async get(id) {
      log.push(`get ${id}`);
      const bytes = objects.get(id);
      if (!bytes) {
        // 与真服务一样回 404；类要从被测模块同一份注册表里取。
        const { SyncError } = await import("../src/sync/transport");
        throw new SyncError("NOT_FOUND", "远端没有这一份。", 404);
      }
      return bytes;
    },
    async putManifest(keyId, index, ids) {
      const updatedAt = new Date().toISOString();
      manifests.delete(deviceId);
      manifests.set(deviceId, {
        deviceId,
        memberId,
        deviceName: deviceId,
        keyId,
        index,
        updatedAt,
      });
      refs.set(deviceId, ids);
      return updatedAt;
    },
    async getManifest() {
      return (
        manifests.get(deviceId) ??
        [...manifests.values()].findLast((m) => m.memberId === memberId) ??
        null
      );
    },
    async manifests() {
      return [...manifests.values()].reverse();
    },
    async prune(keep) {
      if ([...refs.values()].some((ids) => ids === undefined))
        return { removed: 0, bytes: 0 };
      const kept = new Set([...keep, ...[...refs.values()].flat()]);
      let removed = 0;
      for (const id of objects.keys())
        if (!kept.has(id)) {
          objects.delete(id);
          removed++;
        }
      return { removed, bytes: 0 };
    },
    async deleteManifest(id) {
      if (!manifests.has(id)) {
        const { SyncError } = await import("../src/sync/transport");
        throw new SyncError("NOT_FOUND", "远端没有这一份。", 404);
      }
      manifests.delete(id);
      refs.delete(id);
      return { pruned: 0 };
    },
    async wipe() {
      manifests.delete(deviceId);
      refs.delete(deviceId);
    },
    async wipeFamily() {
      manifests.clear();
      refs.clear();
      objects.clear();
    },
  });
  return { client, objects, manifests, log };
}
const key = new Uint8Array(16).fill(31);
const roots: string[] = [];
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
  env.database?.close();
  env.database = null;
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function phone() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anan-family-"));
  roots.push(root);
  env.root = root;
  vi.resetModules();
  const files = await import("../src/local/files");
  const backup = await import("../src/local/backup");
  const engine = await import("../src/sync/engine");
  const family = await import("../src/sync/family");
  const state = await import("../src/sync/state");
  const model = await import("../src/local/model");
  const { LocalStore } = await import("../src/local/store");
  const disk = { read: async () => null, write: vi.fn(async () => {}) };
  const store = new LocalStore(disk);
  await store.open();
  files.ensureDirectories();
  const add = async (id: string, text = id, by = "爸爸", photo = true) => {
    const media = photo
      ? {
          id: `m-${id}`,
          file: `${id}.jpg`,
          name: `${id}.jpg`,
          kind: "image" as const,
          bytes: 3000,
          sha256: sha256Hex(new Uint8Array(3000).fill(id.charCodeAt(0))),
        }
      : null;
    if (media)
      fs.writeFileSync(
        files.mediaFile(media).uri,
        Buffer.alloc(3000, id.charCodeAt(0)),
      );
    await store.change((s) => {
      if (media) s.media[media.id] = media;
      s.drafts[id] = {
        id,
        recordId: null,
        baseRevision: 0,
        updatedAt: "2026-09-20T00:00:00Z",
        content: {
          ...model.emptyContent(),
          text,
          by,
          mediaIds: media ? [media.id] : [],
          coverId: media?.id ?? null,
        },
      };
      model.saveRecord(s, id, `r-${id}`, "2026-09-20T00:00:00Z");
    });
    return media;
  };
  return {
    root,
    files,
    backup,
    engine,
    family,
    state,
    model,
    store,
    disk,
    add,
    activate: () => {
      env.root = root;
    },
  };
}
async function seeded() {
  const remote = fakeRemote();
  const sender = await phone();
  await sender.add("a", "她笑了", "爸爸");
  await sender.add("b", "她翻身了", "妈妈");
  const published = await sender.engine.pushManifest(sender.store.get(), {
    transport: remote.client("爸爸手机"),
    key,
  });
  const receiver = await phone();
  const deps = { transport: remote.client("妈妈手机"), key };
  return { remote, sender, receiver, deps, published };
}

it("keeps the losing text when the disk is full at the moment the conflict is recorded", async () => {
  const { receiver: p, deps } = await seeded();
  // This phone has its own, older edit of r-a that exists nowhere else (never pushed).
  await p.add("a", "本机的旧版本——只在这台手机上", "外婆", false);
  await p.store.change((s) => {
    s.records["r-a"] = { ...s.records["r-a"]!, updatedAt: "2026-09-19T00:00:00Z" };
  });
  p.state.writeRemoteState(p.state.freshRemoteState(keyIdOf(key)));
  // Merge commits the newer remote text into the library, then writing conflicts.json hits ENOSPC.
  env.fullOn = "conflicts.json.part";
  await expect(p.family.runFamilySync(p.store, deps)).rejects.toThrow("ENOSPC");
  // Space is freed; the next (auto-)sync runs normally.
  await p.family.runFamilySync(p.store, deps);
  expect(p.store.get().records["r-a"]?.text).toBe("她笑了");
  const conflicts = await p.state.readConflicts();
  // Today: [] — base.json was not advanced either, the re-merge sees identical text on both
  // sides, so no conflict is recorded and 「本机的旧版本」 is gone for good.
  expect(conflicts.find((c) => c.key === "records:r-a")?.loser.text).toBe(
    "本机的旧版本——只在这台手机上",
  );
});
