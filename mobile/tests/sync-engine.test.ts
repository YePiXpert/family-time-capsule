import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  SyncError,
  type RemoteManifest,
  type Transport,
} from "../src/sync/transport";
import { keyIdOf, sha256Hex } from "../src/sync/crypto";
const env = vi.hoisted(() => ({
  root: "",
  free: Number.POSITIVE_INFINITY,
  rejectActivation: false,
  database: null as DatabaseSync | null,
}));
vi.mock("expo-file-system", async () =>
  (await import("./helpers/expo-file-system-fake")).createExpoFileSystemFake(
    env,
  ),
);
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
    getItemAsync: async (key: string) => store.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      store.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      store.delete(key);
    },
  };
});
/** 内存版远端：对象与清单索引各一张表，put 会核密文哈希，log 记下每次调用好数次数。 */
function fakeRemote() {
  const objects = new Map<string, Uint8Array>();
  let manifest: RemoteManifest | null = null;
  const log: string[] = [];
  let failPuts = 0;
  const transport: Transport = {
    async status() {
      log.push("status");
      return {
        keyId: manifest?.keyId ?? null,
        manifestUpdatedAt: manifest?.updatedAt ?? null,
        objects: objects.size,
        bytes: [...objects.values()].reduce((n, b) => n + b.length, 0),
        limitBytes: 20 * 1024 ** 3,
        freeBytes: 100 * 1024 ** 3,
        manifests: manifest ? 1 : 0,
      };
    },
    async missing(ids) {
      log.push(`have ${ids.length}`);
      return new Set(ids.filter((id) => !objects.has(id)));
    },
    async put(id, bytes, sha256) {
      log.push(`put ${id}`);
      if (failPuts > 0) {
        failPuts--;
        throw new SyncError("NETWORK", "现在连不上服务，请稍后再试。");
      }
      if (sha256Hex(bytes) !== sha256)
        throw new SyncError("OBJECT_CORRUPT", "对象损坏", 400);
      const created = !objects.has(id);
      objects.set(id, bytes);
      return { created };
    },
    async get(id) {
      log.push(`get ${id}`);
      const found = objects.get(id);
      if (!found) throw new SyncError("NOT_FOUND", "远端没有这一份。", 404);
      return found;
    },
    async putManifest(keyId, index, objects) {
      log.push(`putManifest ${objects.length}`);
      manifest = { keyId, index, updatedAt: new Date().toISOString() };
      return manifest.updatedAt;
    },
    async getManifest() {
      log.push("getManifest");
      return manifest;
    },
    async prune(keep) {
      log.push(`prune ${keep.length}`);
      let removed = 0;
      for (const id of [...objects.keys()])
        if (!keep.includes(id)) {
          objects.delete(id);
          removed++;
        }
      return { removed, bytes: 0 };
    },
    async wipe() {
      objects.clear();
      manifest = null;
    },
    async manifests() {
      log.push("manifests");
      return manifest
        ? [
            {
              deviceId: "device-1",
              memberId: "member-1",
              deviceName: "测试机",
              ...manifest,
            },
          ]
        : [];
    },
    async deleteManifest(deviceId) {
      log.push(`deleteManifest ${deviceId}`);
      manifest = null;
      return { pruned: 0 };
    },
    async wipeFamily() {
      objects.clear();
      manifest = null;
    },
  };
  return {
    transport,
    objects,
    log,
    manifest: () => manifest,
    failNextPuts: (n: number) => {
      failPuts = n;
    },
    puts: () => log.filter((l) => l.startsWith("put ")).length,
    gets: () => log.filter((l) => l.startsWith("get ")).length,
  };
}
const key = () =>
  new Uint8Array(Array.from({ length: 16 }, (_, i) => 31 * i + 3));
beforeEach(() => {
  vi.resetModules();
  env.free = Number.POSITIVE_INFINITY;
  env.rejectActivation = false;
  env.root = fs.mkdtempSync(path.join(os.tmpdir(), "anan-sync-"));
});
afterEach(() => {
  env.database?.close();
  env.database = null;
  fs.rmSync(env.root, { recursive: true, force: true });
});
async function setup() {
  const files = await import("../src/local/files");
  const backup = await import("../src/local/backup");
  const engine = await import("../src/sync/engine");
  const state = await import("../src/sync/state");
  const model = await import("../src/local/model");
  const { openLocalStore } = await import("../src/local/disk");
  const store = await openLocalStore();
  files.ensureDirectories();
  const addPhoto = async (id: string, bytes: Buffer, text: string) => {
    const name = `${id}.jpg`;
    const source = path.join(env.root, name);
    fs.writeFileSync(source, bytes);
    const media = await files.preserveMedia(source, name, "image");
    await store.change((s) => {
      s.welcome = true;
      s.media[media.id] = media;
      s.drafts[id] = {
        id,
        recordId: null,
        baseRevision: 0,
        updatedAt: new Date().toISOString(),
        content: {
          ...model.emptyContent(),
          text,
          mediaIds: [media.id],
          coverId: media.id,
        },
      };
      model.saveRecord(s, id, `r-${id}`, new Date().toISOString());
    });
    return media;
  };
  // 一张 4 MiB + 1 字节的照片会切成两个对象；另一张小的只有一个。
  const big = await addPhoto(
    "big",
    Buffer.alloc(4 * 1048576 + 1, 17),
    "大照片",
  );
  const small = await addPhoto("small", Buffer.alloc(3000, 42), "小照片");
  return { files, backup, engine, state, model, store, big, small };
}
it("uploads every object once, seals the index, records state, and leaks no plaintext", async () => {
  const { engine, state, store, big } = await setup();
  const remote = fakeRemote();
  const stages: string[] = [];
  const result = await engine.runRemoteBackup(store.get(), {
    transport: remote.transport,
    key: key(),
    onProgress: (stage) => stages.push(stage),
  });
  // 两张照片 = 3 个对象，清单 1 个对象。
  expect(remote.puts()).toBe(4);
  expect(remote.objects.size).toBe(4);
  expect(remote.manifest()?.keyId).toBe(keyIdOf(key()));
  expect(result).toMatchObject({
    version: 2,
    enabled: true,
    autoSync: true,
    seen: {},
    keyId: keyIdOf(key()),
    lastSyncSummary: { devices: 1, objects: 4, pushed: 4, conflicts: 0 },
  });
  expect(result.lastSyncSummary!.bytes).toBeGreaterThan(4 * 1048576 + 3000);
  expect(result.joinedAt).toBe(result.lastSyncAt);
  expect(await state.readRemoteState()).toEqual(result);
  expect(stages).toContain("正在上传 4/4");
  // 清单登记全部 4 个对象，prune 的 keep 也是这 4 个。
  expect(remote.log.slice(-2)).toEqual(["putManifest 4", "prune 4"]);
  // 对象 id 不是照片哈希，密文里也没有照片的字节。
  expect(remote.objects.has(big.sha256)).toBe(false);
  const run = Buffer.alloc(4096, 17);
  for (const bytes of remote.objects.values())
    expect(Buffer.from(bytes).includes(run)).toBe(false);
  expect(remote.manifest()!.index).not.toContain(big.sha256);
});
it("uploads only what the remote lacks on the next run", async () => {
  const { engine, store, files, model } = await setup();
  const remote = fakeRemote();
  const deps = { transport: remote.transport, key: key() };
  await engine.runRemoteBackup(store.get(), deps);
  const before = remote.puts();
  // 照片没变：只传一份新时间戳的清单对象，旧清单对象被 prune 掉。
  await engine.runRemoteBackup(store.get(), deps);
  expect(remote.puts()).toBe(before + 1);
  expect(remote.objects.size).toBe(4);
  const source = path.join(env.root, "third.jpg");
  fs.writeFileSync(source, Buffer.alloc(5000, 9));
  const media = await files.preserveMedia(source, "third.jpg", "image");
  await store.change((s) => {
    s.media[media.id] = media;
    s.drafts.t = {
      id: "t",
      recordId: null,
      baseRevision: 0,
      updatedAt: new Date().toISOString(),
      content: {
        ...model.emptyContent(),
        text: "第三张",
        mediaIds: [media.id],
        coverId: media.id,
      },
    };
    model.saveRecord(s, "t", "r-t", new Date().toISOString());
  });
  await engine.runRemoteBackup(store.get(), deps);
  // 新照片 1 个对象 + 新清单 1 个对象。
  expect(remote.puts()).toBe(before + 3);
  expect(remote.objects.size).toBe(5);
});
it("keeps uploaded objects when a put fails and resumes from there", async () => {
  const { engine, state, store } = await setup();
  const remote = fakeRemote();
  const deps = { transport: remote.transport, key: key() };
  remote.failNextPuts(1);
  await expect(engine.runRemoteBackup(store.get(), deps)).rejects.toThrow(
    "连不上",
  );
  expect(await state.readRemoteState()).toBeNull();
  expect(remote.objects.size).toBe(0);
  remote.failNextPuts(0);
  await engine.runRemoteBackup(store.get(), deps);
  expect(remote.objects.size).toBe(4);
  // 第一轮 1 次失败，第二轮补齐 4 次：一共 5 次 put，没有重复传已到的对象。
  expect(remote.puts()).toBe(5);
});
it("refuses to stack onto another key's backup and stops before uploading", async () => {
  const { engine, store } = await setup();
  const remote = fakeRemote();
  await engine.runRemoteBackup(store.get(), {
    transport: remote.transport,
    key: key(),
  });
  const other = new Uint8Array(16).fill(77);
  const error = await engine
    .runRemoteBackup(store.get(), { transport: remote.transport, key: other })
    .catch((e: unknown) => e as SyncError);
  // vi.resetModules 之后引擎里的 SyncError 是另一份类定义，按名字与 code 认。
  expect((error as SyncError).name).toBe("SyncError");
  expect((error as SyncError).code).toBe("KEY_MISMATCH");
  expect(remote.puts()).toBe(4);
  const controller = new AbortController();
  controller.abort();
  await expect(
    engine.runRemoteBackup(store.get(), {
      transport: remote.transport,
      key: key(),
      signal: controller.signal,
    }),
  ).rejects.toThrow("已停止");
});
it("pins the remote manifest before downloading so an interrupted restore survives blob collection", async () => {
  const { engine, backup, files, store, big, small } = await setup();
  const remote = fakeRemote();
  const deps = { transport: remote.transport, key: key() };
  await engine.runRemoteBackup(store.get(), deps);
  fs.rmSync(files.blobDirectory.uri, { recursive: true });
  for (const f of fs.readdirSync(files.backupDirectory.uri))
    fs.unlinkSync(path.join(files.backupDirectory.uri, f));
  // 第一张下载完就停。
  const controller = new AbortController();
  await expect(
    engine.restoreFromRemote({
      ...deps,
      signal: controller.signal,
      onProgress: (stage) => {
        if (stage === "正在下载 1/2") controller.abort();
      },
    }),
  ).rejects.toThrow("已停止");
  const left = fs.readdirSync(files.backupDirectory.uri);
  expect(left).toHaveLength(1);
  expect(left[0]).toMatch(/^restoring-.*\.xmbm\.part$/);
  const downloaded = [big, small].filter((m) =>
    fs.existsSync(files.blobFile(m.sha256).uri),
  );
  expect(downloaded).toHaveLength(1);
  // 中间做了一次本机回收：钉子护住了已下载的那张。
  expect(backup.collectBlobs()).toEqual({ removed: 0, bytes: 0 });
  expect(fs.existsSync(files.blobFile(downloaded[0]!.sha256).uri)).toBe(true);
  // 接着恢复：只拉清单对象和剩下那张照片的对象，钉子换成正式清单。
  const gets = remote.gets();
  const manifest = await engine.restoreFromRemote(deps);
  const remaining = downloaded[0] === big ? 1 : 2;
  expect(remote.gets()).toBe(gets + 1 + remaining);
  expect(fs.readdirSync(files.backupDirectory.uri)).toEqual([manifest.name]);
  expect(manifest.name).toMatch(/\.xmbm$/);
});
it("verifies the remote and names how many photo objects are missing", async () => {
  const { engine, store } = await setup();
  const remote = fakeRemote();
  const deps = { transport: remote.transport, key: key() };
  await expect(engine.verifyRemoteBackup(deps)).rejects.toThrow("还没有备份");
  await engine.runRemoteBackup(store.get(), deps);
  const summary = await engine.verifyRemoteBackup(deps);
  expect(summary.objects).toBe(4);
  expect(summary.bytes).toBeGreaterThan(4 * 1048576);
  const manifestId = remote.log
    .filter((l) => l.startsWith("put "))
    .at(-1)!
    .slice(4);
  const victim = [...remote.objects.keys()].find((id) => id !== manifestId)!;
  remote.objects.delete(victim);
  await expect(engine.verifyRemoteBackup(deps)).rejects.toThrow("少了 1 份");
  await expect(
    engine.verifyRemoteBackup({ ...deps, key: new Uint8Array(16).fill(5) }),
  ).rejects.toThrow("恢复码");
});
it("restores from the remote into the blob store and hands a manifest to the local restore", async () => {
  const { engine, backup, files, store, model, big, small } = await setup();
  const remote = fakeRemote();
  const deps = { transport: remote.transport, key: key() };
  await engine.runRemoteBackup(store.get(), deps);
  // 换手机：本机 blob 库与记录都没了。
  fs.rmSync(files.blobDirectory.uri, { recursive: true });
  for (const f of fs.readdirSync(files.backupDirectory.uri))
    fs.unlinkSync(path.join(files.backupDirectory.uri, f));
  await store.change((s) => {
    model.deleteRecord(s, "r-big");
    model.deleteRecord(s, "r-small");
  });
  const stages: string[] = [];
  const manifest = await engine.restoreFromRemote({
    ...deps,
    onProgress: (s) => stages.push(s),
  });
  expect(manifest.name).toMatch(/\.xmbm$/);
  expect(stages).toContain("正在下载 2/2");
  // 4 MiB 的 Buffer 别交给 toEqual 逐字节深比较，慢得像卡住。
  expect(
    fs
      .readFileSync(files.blobFile(big.sha256).uri)
      .equals(Buffer.alloc(4 * 1048576 + 1, 17)),
  ).toBe(true);
  await backup.restoreBackup(store, manifest);
  expect(store.get().records["r-big"]?.text).toBe("大照片");
  expect(
    fs.readFileSync(files.mediaFile(store.get().media[small.id]!).uri),
  ).toEqual(Buffer.alloc(3000, 42));
  // 再来一次只拉清单：blob 已在库里就是续传。
  const gets = remote.gets();
  await engine.restoreFromRemote(deps);
  expect(remote.gets()).toBe(gets + 1);
  // 错的恢复码在下载任何对象之前就判出；被改动的对象整份失败、不留半成品、不写清单。
  await expect(
    engine.restoreFromRemote({ ...deps, key: new Uint8Array(16).fill(1) }),
  ).rejects.toThrow("恢复码");
  expect(remote.gets()).toBe(gets + 1);
  fs.rmSync(files.blobDirectory.uri, { recursive: true });
  // 失败的恢复留下的只有钉子（restoring-*.xmbm.part），正式清单一份不多。
  const manifestsOf = () =>
    fs.readdirSync(files.backupDirectory.uri).filter((n) => n.endsWith(".xmbm"))
      .length;
  const manifests = manifestsOf();
  const smallId = [...remote.objects.entries()].find(
    ([, b]) => b.length < 4000,
  )![0];
  const tampered = new Uint8Array(remote.objects.get(smallId)!);
  tampered[tampered.length - 1]! ^= 1;
  remote.objects.set(smallId, tampered);
  await expect(engine.restoreFromRemote(deps)).rejects.toThrow("对不上");
  expect(manifestsOf()).toBe(manifests);
  const leftovers = fs
    .readdirSync(files.blobDirectory.uri, { recursive: true })
    .map(String);
  expect(leftovers.some((n) => n.endsWith(".part"))).toBe(false);
});
