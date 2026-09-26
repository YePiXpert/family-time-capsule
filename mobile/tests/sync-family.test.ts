import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { twoPhonesWriteTogether } from "./helpers/family-two-phones";
import {
  type RemoteDeviceManifest,
  type Transport,
} from "../src/sync/transport";
import {
  keyIdOf,
  sha256Hex,
  objectIdOf,
  openSmall,
  fromBase64,
  sealObject,
} from "../src/sync/crypto";
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
function directoryBytes(uri: string) {
  return Object.fromEntries(
    fs
      .readdirSync(uri)
      .sort()
      .map((name) => [
        name,
        fs.readFileSync(path.join(uri, name)).toString("hex"),
      ]),
  );
}
it.each(["memory", "SQLite"])(
  "两台手机一起写（%s）：落款、照片、墓碑、冲突留底与退出",
  async (storage) => {
    const remote = fakeRemote();
    const phones = new Map<string, Awaited<ReturnType<typeof phone>>>();
    await twoPhonesWriteTogether({
      key,
      transportA: remote.client("爸爸手机"),
      transportB: remote.client("妈妈手机"),
      openPhone: async (root) => {
        if (storage === "SQLite") {
          env.database?.close();
          env.database = null;
          env.root = root ?? fs.mkdtempSync(path.join(os.tmpdir(), "anan-family-"));
          if (!root) roots.push(env.root);
          vi.resetModules();
          const files = await import("../src/local/files");
          const family = await import("../src/sync/family");
          const model = await import("../src/local/model");
          const state = await import("../src/sync/state");
          const { openLocalStore } = await import("../src/local/disk");
          const store = await openLocalStore();
          files.ensureDirectories();
          return { root: env.root, files, family, model, state, store };
        }
        const p = root ? phones.get(root)! : await phone();
        phones.set(p.root, p);
        p.activate();
        return p;
      },
    });
  },
);
it("空库加入拉齐时光、落款、原件与本机缩略图，并登记本机清单", async () => {
  const { receiver: p, remote, deps } = await seeded();
  const result = await p.family.joinFamily(p.store, key, deps);
  expect(p.store.get().records["r-a"]?.by).toBe("爸爸");
  expect(p.store.get().records["r-b"]?.by).toBe("妈妈");
  for (const m of Object.values(p.store.get().media)) {
    expect(sha256Hex(fs.readFileSync(p.files.mediaFile(m).uri))).toBe(m.sha256);
    expect(fs.readFileSync(p.files.thumbFile(m)!.uri, "utf8")).toBe(
      "thumb-bytes",
    );
    expect(m).toMatchObject({ width: 512, height: 384 });
  }
  expect(result.lastSyncSummary).toMatchObject({
    devices: 2,
    pulled: 2,
    conflicts: 0,
  });
  expect(result.seen["妈妈手机"]).toBe(
    p.engine.parseIndex(
      openSmall(
        key,
        p.engine.INDEX_LABEL,
        fromBase64(remote.manifests.get("妈妈手机")!.index),
      ),
    ).sha256,
  );
  expect(await p.state.readRemoteState()).toEqual(result);
  expect(p.backup.restorePins()).toHaveLength(0);
});
it("取定上传那一版在合并写入本机之后：自动同步据此只补排之后的改动", async () => {
  const { receiver: p, deps } = await seeded();
  const events: string[] = [];
  const unsubscribe = p.store.subscribe(() => events.push("write"));
  await p.family.joinFamily(p.store, key, {
    ...deps,
    onSnapshot: () => events.push("snapshot"),
  });
  unsubscribe();
  expect(events.filter((e) => e === "snapshot")).toHaveLength(1);
  expect(events.lastIndexOf("write")).toBeLessThan(events.indexOf("snapshot"));
});
it("同步期间关闭自动同步，完成后仍保留关闭状态", async () => {
  const { receiver: p, deps } = await seeded();
  await p.family.joinFamily(p.store, key, deps);
  await p.add("local", "刚写的", "妈妈", false);
  const publish = deps.transport.putManifest.bind(deps.transport);
  vi.spyOn(deps.transport, "putManifest").mockImplementationOnce(async (...args) => {
    const current = await p.state.readRemoteState();
    p.state.writeRemoteState({ ...current!, autoSync: false });
    return publish(...args);
  });
  const result = await p.family.runFamilySync(p.store, deps);
  expect(result.autoSync).toBe(false);
  expect((await p.state.readRemoteState())?.autoSync).toBe(false);
});
it.each([false, true])("内容未变不上传、不发布、不回收远端对象（缺少旧统计：%s）", async (withoutSummary) => {
  const { receiver: p, deps } = await seeded();
  const first = await p.family.joinFamily(p.store, key, deps);
  if (withoutSummary) {
    const state = { ...first };
    delete state.lastSyncSummary;
    p.state.writeRemoteState(state);
  }
  const put = vi.spyOn(deps.transport, "put");
  const publish = vi.spyOn(deps.transport, "putManifest");
  const prune = vi.spyOn(deps.transport, "prune");
  const create = vi.spyOn(p.backup, "createSyncManifest");
  const second = await p.family.runFamilySync(p.store, deps);
  expect(put).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
  expect(prune).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(second.lastPush).toEqual(first.lastPush);
  expect(second.seen).toEqual(first.seen);
  expect(second.lastSyncSummary).toMatchObject({
    objects: withoutSummary ? 0 : first.lastSyncSummary!.objects,
    bytes: withoutSummary ? 0 : first.lastSyncSummary!.bytes,
    pulled: 0,
    pushed: 0,
  });
  expect(await p.state.readRemoteState()).toEqual(second);
});
it("本机改了一段后重新发布，实体指纹随之变化", async () => {
  const { receiver: p, deps } = await seeded();
  const first = await p.family.joinFamily(p.store, key, deps);
  await p.store.change((s) => {
    s.records["r-a"] = {
      ...s.records["r-a"]!, text: "今天又笑了", updatedAt: "2026-09-23T00:00:00Z",
    };
  });
  const put = vi.spyOn(deps.transport, "put");
  const publish = vi.spyOn(deps.transport, "putManifest");
  const prune = vi.spyOn(deps.transport, "prune");
  const second = await p.family.runFamilySync(p.store, deps);
  expect(put).toHaveBeenCalled();
  expect(publish).toHaveBeenCalledTimes(1);
  expect(prune).toHaveBeenCalledTimes(1);
  expect(second.lastPush!.entitiesSha).not.toBe(first.lastPush!.entitiesSha);
  // 没传进度回调也要数对上传份数（自动同步不传回调）。
  expect(second.lastSyncSummary!.pushed).toBeGreaterThan(0);
  expect(second.lastSyncSummary!.pushed).toBe(put.mock.calls.length);
});
it.each(["deleted", "legacy", "unknown-device"])("内容未变但 %s 时仍发布清单", async (reason) => {
  const { receiver: p, deps } = await seeded();
  const first = await p.family.joinFamily(p.store, key, deps);
  if (reason === "deleted") await deps.transport.deleteManifest(first.deviceId!);
  else {
    const state = { ...first };
    if (reason === "legacy") delete state.lastPush;
    else delete state.deviceId;
    p.state.writeRemoteState(state);
  }
  const publish = vi.spyOn(deps.transport, "putManifest");
  const prune = vi.spyOn(deps.transport, "prune");
  const second = await p.family.runFamilySync(p.store, deps);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(prune).toHaveBeenCalledTimes(1);
  expect(second.lastPush!.entitiesSha).toBe(first.lastPush!.entitiesSha);
  expect(second.lastPush!.manifestSha).toBe(second.seen[second.deviceId!]);
});
it("恢复了一份旧备份：重读全家清单，家人之后的改动按世系并回来，不出卡", async () => {
  const { receiver: p, sender, remote, deps } = await seeded();
  await p.family.joinFamily(p.store, key, deps);
  const before = structuredClone(p.store.get().records["r-a"]!);
  sender.activate();
  const { lineage } = await import("../src/local/hash");
  await sender.store.change((s) => {
    const previous = s.records["r-a"]!;
    s.records["r-a"] = {
      ...previous,
      text: "她笑了，还会拍手了",
      updatedAt: "2026-09-23T00:00:00Z",
      ancestors: lineage(previous),
    };
  });
  await sender.engine.pushManifest(sender.store.get(), {
    transport: remote.client("爸爸手机"),
    key,
  });
  p.activate();
  await p.family.runFamilySync(p.store, deps);
  expect(p.store.get().records["r-a"]!.text).toBe("她笑了，还会拍手了");
  // 换回备份那一刻的库（restoreBackup 的结果），备份页随后清掉合并记录。
  await p.store.change((s) => {
    s.records["r-a"] = before;
  });
  await p.state.forgetMergeHistory();
  const result = await p.family.runFamilySync(p.store, deps);
  expect(p.store.get().records["r-a"]!.text).toBe("她笑了，还会拍手了");
  expect(result.lastSyncSummary!.conflicts).toBe(0);
  expect(await p.state.readConflicts()).toEqual([]);
});
it("有一份录到一半的草稿：库没变就不再重传清单", async () => {
  const { receiver: p, deps } = await seeded();
  await p.store.change((s) => {
    s.drafts.d = {
      id: "d",
      recordId: null,
      baseRevision: 0,
      updatedAt: "2026-09-20T00:00:00Z",
      content: { ...p.model.emptyContent(), text: "说到一半" },
      recordingFile: "ExpoAudio/pending.m4a",
    };
  });
  await p.family.joinFamily(p.store, key, deps);
  const publish = vi.spyOn(deps.transport, "putManifest");
  const again = await p.family.runFamilySync(p.store, deps);
  expect(publish).not.toHaveBeenCalled();
  expect(again.lastSyncSummary!.pushed).toBe(0);
  expect(p.store.get().drafts.d!.recordingFile).toBe("ExpoAudio/pending.m4a");
});
it("第二次只下载变化的设备，未变设备与本机自己的清单都跳过", async () => {
  const { receiver: p, sender, remote, deps, published } = await seeded();
  const third = await phone();
  await third.add("c", "外婆写的", "外婆");
  const unchanged = await third.engine.pushManifest(third.store.get(), {
    transport: remote.client("外婆手机"),
    key,
  });
  p.activate();
  const first = await p.family.joinFamily(p.store, key, deps);
  sender.activate();
  await sender.store.change((s) => {
    s.records["r-a"] = {
      ...s.records["r-a"]!,
      text: "又笑了",
      updatedAt: "2026-09-22T00:00:00Z",
    };
  });
  const changed = await sender.engine.pushManifest(sender.store.get(), {
    transport: remote.client("爸爸手机"),
    key,
  });
  p.activate();
  remote.log.length = 0;
  const publish = vi.spyOn(deps.transport, "putManifest");
  const second = await p.family.runFamilySync(p.store, deps);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(second.lastSyncSummary!.pulled).toBeGreaterThan(0);
  expect(second.lastPush!.entitiesSha).not.toBe(first.lastPush!.entitiesSha);
  expect(remote.log.filter((l) => l.startsWith("get "))).toEqual([
    `get ${objectIdOf(key, changed.index.sha256, 0)}`,
  ]);
  expect(remote.log).not.toContain(
    `get ${objectIdOf(key, unchanged.index.sha256, 0)}`,
  );
  expect(remote.log).not.toContain(
    `get ${objectIdOf(key, published.index.sha256, 0)}`,
  );
  expect(p.store.get().records["r-a"]?.text).toBe("又笑了");
});
it("推送只传缺的对象，已有照片不再传一次", async () => {
  const { receiver: p, remote, deps } = await seeded();
  const existing = new Set(remote.objects.keys());
  remote.log.length = 0;
  await p.family.joinFamily(p.store, key, deps);
  const puts = remote.log
    .filter((l) => l.startsWith("put "))
    .map((l) => l.slice(4));
  expect(puts).toHaveLength(1);
  expect(puts.every((id) => !existing.has(id))).toBe(true);
  remote.log.length = 0;
  await p.add("c");
  await p.family.runFamilySync(p.store, deps);
  expect(remote.log.filter((l) => l.startsWith("put "))).toHaveLength(2);
});
it("停止后钉子护住已下好的 blob，回收后重试也不重下", async () => {
  const { receiver: p, remote, deps } = await seeded();
  const abort = new AbortController();
  await expect(
    p.family.joinFamily(p.store, key, {
      ...deps,
      signal: abort.signal,
      onProgress: (s) => {
        if (s === "正在下载 1/2") abort.abort();
      },
    }),
  ).rejects.toMatchObject({ code: "CANCELED", message: "已停止。" });
  expect(Object.keys(p.store.get().records)).toHaveLength(0);
  expect(p.backup.restorePins()).toHaveLength(1);
  expect(p.backup.collectBlobs()).toEqual({ removed: 0, bytes: 0 });
  const firstSha = sha256Hex(new Uint8Array(3000).fill("a".charCodeAt(0)));
  expect(p.files.blobFile(firstSha).exists).toBe(true);
  remote.log.length = 0;
  await p.family.runFamilySync(p.store, deps);
  expect(remote.log).not.toContain(`get ${objectIdOf(key, firstSha, 0)}`);
  expect(remote.log.filter((l) => l.startsWith("get "))).toHaveLength(2);
  expect(p.backup.restorePins()).toHaveLength(0);
});
it.each(["change", "disk"])(
  "%s 写入失败时库与 media 目录原样保留，blob 留待续传",
  async (failure) => {
    const { receiver: p, deps } = await seeded();
    await p.add("local");
    const before = p.store.get();
    const media = directoryBytes(p.files.mediaDirectory.uri);
    if (failure === "change")
      vi.spyOn(p.store, "change").mockRejectedValueOnce(new Error("写不进去"));
    else p.disk.write.mockRejectedValueOnce(new Error("写不进去"));
    await expect(p.family.joinFamily(p.store, key, deps)).rejects.toThrow(
      "写不进去",
    );
    expect(p.store.get()).toBe(before);
    expect(directoryBytes(p.files.mediaDirectory.uri)).toEqual(media);
    expect(p.backup.collectBlobs()).toEqual({ removed: 0, bytes: 0 });
    await p.family.runFamilySync(p.store, deps);
    expect(Object.keys(p.store.get().records)).toHaveLength(3);
  },
);
it("物化同名文件另起名字，不覆盖原件或不在库里的文件", async () => {
  const { receiver: p, deps } = await seeded();
  fs.writeFileSync(path.join(p.files.mediaDirectory.uri, "a.jpg"), "本机已有");
  await p.family.joinFamily(p.store, key, deps);
  expect(
    fs.readFileSync(path.join(p.files.mediaDirectory.uri, "a.jpg"), "utf8"),
  ).toBe("本机已有");
  expect(p.store.get().media["m-a"]?.file).not.toBe("a.jpg");
  expect(
    sha256Hex(
      fs.readFileSync(p.files.mediaFile(p.store.get().media["m-a"]!).uri),
    ),
  ).toBe(p.store.get().media["m-a"]?.sha256);
});
it("下载期间本机又写的时光不会被覆盖，写入与推送都包含它", async () => {
  const { receiver: p, deps } = await seeded();
  const get = deps.transport.get;
  let written = false;
  deps.transport.get = async (id) => {
    if (
      !written &&
      id === objectIdOf(key, sha256Hex(new Uint8Array(3000).fill(97)), 0)
    ) {
      written = true;
      await p.add("local", "下载时刚写的", "妈妈", false);
    }
    return get(id);
  };
  await p.family.joinFamily(p.store, key, deps);
  expect(p.store.get().records["r-local"]?.text).toBe("下载时刚写的");
  const { meta, entities } = await p.engine.fetchManifestOf(
    (await deps.transport.getManifest())!,
    deps,
  );
  const { decodeLibraryV2 } = await import("../src/local/backup-format");
  expect(decodeLibraryV2(meta, entities).records["r-local"]?.text).toBe(
    "下载时刚写的",
  );
});
it("最终合并遇到未准备的素材就拒绝写库，下一轮可补齐", async () => {
  const { receiver: p, deps } = await seeded();
  await p.add("a");
  const before = directoryBytes(p.files.mediaDirectory.uri);
  let pending: Promise<unknown> | undefined;
  await expect(
    p.family.joinFamily(p.store, key, {
      ...deps,
      onProgress: (stage) => {
        if (stage === "正在写入本机资料…")
          pending = p.store.change((s) => {
            s.records = {};
            s.media = {};
          });
      },
    }),
  ).rejects.toMatchObject({ code: "INCOMPLETE" });
  await pending;
  expect(p.store.get().records).toEqual({});
  expect(directoryBytes(p.files.mediaDirectory.uri)).toEqual(before);
  await p.family.runFamilySync(p.store, deps);
  expect(Object.keys(p.store.get().records)).toHaveLength(2);
});
it("远端清单能解密但全文 sha 对不上时，本机不变且没有半份素材", async () => {
  const { receiver: p, remote, deps, published } = await seeded();
  const id = objectIdOf(key, published.index.sha256, 0);
  const { objectsOf } = await import("../src/sync/planner");
  const plan = objectsOf(published.index.sha256, published.index.bytes)[0]!;
  const good = remote.objects.get(id)!;
  remote.objects.set(id, sealObject(key, plan, [new Uint8Array(plan.bytes)]));
  const before = p.store.get();
  // 别人那份坏了只跳过那一台：本机照常加入、发布自己的清单，不写库、不留半份素材，结果里说清楚。
  const joined = await p.family.joinFamily(p.store, key, deps);
  expect(joined.lastSyncSummary).toMatchObject({ pulled: 0, unread: 1 });
  expect(joined.seen["爸爸手机"]).toBeUndefined();
  expect(p.store.get().records).toEqual(before.records);
  expect(directoryBytes(p.files.mediaDirectory.uri)).toEqual({});
  // 那一份修好（对方重新发布）后，下一轮照常并进来。
  remote.objects.set(id, good);
  const next = await p.family.runFamilySync(p.store, deps);
  expect(next.lastSyncSummary!.unread).toBeUndefined();
  expect(p.store.get().records["r-a"]?.text).toBe("她笑了");
});
it("别人的一张照片在远端缺了：只跳过带着它的那一台，其他手机的改动照常并入并发布", async () => {
  // 被测手机最后建：假远端抛的 SyncError 要与它同一份模块注册表。
  const remote = fakeRemote();
  const third = await phone();
  await third.add("c", "外婆写的", "外婆", false);
  await third.engine.pushManifest(third.store.get(), {
    transport: remote.client("外婆手机"),
    key,
  });
  const sender = await phone();
  await sender.add("a", "她笑了", "爸爸");
  await sender.add("b", "她翻身了", "妈妈");
  await sender.engine.pushManifest(sender.store.get(), {
    transport: remote.client("爸爸手机"),
    key,
  });
  const photo = sender.store.get().media["m-a"]!;
  const p = await phone();
  const deps = { transport: remote.client("妈妈手机"), key };
  const lost = objectIdOf(key, photo.sha256, 0);
  const bytes = remote.objects.get(lost)!;
  remote.objects.delete(lost);
  const publish = vi.spyOn(deps.transport, "putManifest");
  const result = await p.family.joinFamily(p.store, key, deps);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(result.lastSyncSummary).toMatchObject({ unread: 1 });
  expect(Object.keys(p.store.get().records)).toEqual(["r-c"]);
  expect(result.seen["爸爸手机"]).toBeUndefined();
  remote.objects.set(lost, bytes);
  await p.family.runFamilySync(p.store, deps);
  expect(Object.keys(p.store.get().records).sort()).toEqual(["r-a", "r-b", "r-c"]);
});
it("读不了的是本机自己的旧清单（清过同步状态）：整轮报错、不发布，免得换掉那份历史", async () => {
  const { receiver: p, remote, deps } = await seeded();
  const first = await p.family.joinFamily(p.store, key, deps);
  const own = remote.manifests.get("妈妈手机")!;
  const { parseIndex, INDEX_LABEL } = await import("../src/sync/engine");
  const { openSmall, fromBase64 } = await import("../src/sync/crypto");
  const index = parseIndex(openSmall(key, INDEX_LABEL, fromBase64(own.index)));
  remote.objects.delete(objectIdOf(key, index.sha256, 0));
  p.state.clearSyncFiles();
  p.state.writeRemoteState(p.state.freshRemoteState(keyIdOf(key)));
  const publish = vi.spyOn(deps.transport, "putManifest");
  await expect(p.family.runFamilySync(p.store, deps)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(publish).not.toHaveBeenCalled();
  expect(remote.manifests.get("妈妈手机")!.index).toBe(own.index);
  expect(first.deviceId).toBe("妈妈手机");
});
it("最新钥匙不同则拒绝同步，错误恢复码不会替换钥匙或同步状态", async () => {
  const { receiver: p, deps } = await seeded();
  await p.state.storeKey(key);
  p.state.writeRemoteState(p.state.freshRemoteState(keyIdOf(key)));
  const before = await p.state.readRemoteState();
  const other = new Uint8Array(16).fill(9);
  await expect(p.family.joinFamily(p.store, other, deps)).rejects.toMatchObject(
    { code: "WRONG_CODE" },
  );
  expect(await p.state.loadKey()).toEqual(key);
  expect(await p.state.readRemoteState()).toEqual(before);
  await expect(
    p.family.runFamilySync(p.store, { ...deps, key: other }),
  ).rejects.toMatchObject({ code: "KEY_MISMATCH" });
});
it("旧钥匙残留跳过，老服务端没有 deviceId 仍能同步且不造出设备名", async () => {
  const { receiver: p, remote, deps } = await seeded();
  const latest = remote.manifests.get("爸爸手机")!;
  remote.manifests.clear();
  remote.manifests.set("old", {
    ...latest,
    deviceId: "old",
    keyId: "another-key",
    index: "无法解密",
  });
  remote.manifests.set("爸爸手机", latest);
  deps.transport.me = async () => ({ deviceId: null });
  const result = await p.family.joinFamily(p.store, key, deps);
  expect(Object.keys(result.seen)).toEqual(["爸爸手机"]);
  await p.family.runFamilySync(p.store, deps);
  expect(Object.keys(p.store.get().records)).toHaveLength(2);
  expect(await p.state.readConflicts()).toEqual([]);
});
it("退出只删本设备的清单与同步状态，库和素材逐字节不变", async () => {
  const { receiver: p, remote, deps } = await seeded();
  await p.family.joinFamily(p.store, key, deps);
  const before = p.store.get();
  const media = directoryBytes(p.files.mediaDirectory.uri);
  expect(await p.family.leaveFamily(deps)).toEqual({ removedRemote: true });
  expect(remote.manifests.has("妈妈手机")).toBe(false);
  expect(remote.manifests.has("爸爸手机")).toBe(true);
  expect(await p.state.loadKey()).toBeNull();
  expect(await p.state.readRemoteState()).toBeNull();
  expect(fs.readdirSync(p.state.syncDirectory.uri)).toEqual(["conflicts.json"]);
  expect(p.store.get()).toBe(before);
  expect(directoryBytes(p.files.mediaDirectory.uri)).toEqual(media);
});
it("同成员两台手机中未发布的 B 退出，不删回退得到的 A 清单", async () => {
  const remote = fakeRemote();
  const a = await phone();
  await a.add("a", "A 独有的时光");
  await a.engine.pushManifest(a.store.get(), {
    transport: remote.client("A", "主人"),
    key,
  });
  const p = await phone();
  await p.add("b", "B 本机的时光");
  const deps = { transport: remote.client("B", "主人"), key };
  await p.state.storeKey(key);
  p.state.writeRemoteState(p.state.freshRemoteState(keyIdOf(key)));
  p.state.writeBase(p.state.emptyBase());
  p.state.writeConflicts([]);
  const { SyncError } = await import("../src/sync/transport");
  vi.spyOn(deps.transport, "putManifest").mockRejectedValueOnce(
    new SyncError("NETWORK", "首次发布前断网"),
  );
  await expect(p.family.runFamilySync(p.store, deps)).rejects.toMatchObject({
    code: "NETWORK",
  });
  expect(remote.manifests.has("B")).toBe(false);
  expect((await deps.transport.getManifest())?.deviceId).toBe("A");
  expect((await p.state.readRemoteState())?.deviceId).toBeUndefined();
  expect(fs.readdirSync(p.state.syncDirectory.uri).sort()).toEqual([
    "base.json",
    "conflicts.json",
    "manifest.xmbm",
    "state.json",
  ]);
  const before = structuredClone(p.store.get());
  const media = directoryBytes(p.files.mediaDirectory.uri);
  const manifestA = remote.manifests.get("A");
  const me = vi.spyOn(deps.transport, "me");
  const get = vi.spyOn(deps.transport, "getManifest");
  const remove = vi.spyOn(deps.transport, "deleteManifest");
  expect(await p.family.leaveFamily(deps)).toEqual({ removedRemote: false });
  expect(me).toHaveBeenCalledOnce();
  expect(get).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledWith("B", undefined);
  expect(remote.manifests.get("A")).toEqual(manifestA);
  expect(await p.state.loadKey()).toBeNull();
  expect(await p.state.readRemoteState()).toBeNull();
  expect(fs.readdirSync(p.state.syncDirectory.uri)).toEqual(["conflicts.json"]);
  expect(p.store.get()).toEqual(before);
  expect(directoryBytes(p.files.mediaDirectory.uri)).toEqual(media);
});
it("Build 71 升级后未记设备 ID，通过 me 删除自己的清单", async () => {
  const remote = fakeRemote();
  const p = await phone();
  await p.add("a");
  const deps = { transport: remote.client("A", "主人"), key };
  await p.engine.pushManifest(p.store.get(), deps);
  await p.state.storeKey(key);
  fs.mkdirSync(p.state.syncDirectory.uri, { recursive: true });
  fs.writeFileSync(
    path.join(p.state.syncDirectory.uri, "state.json"),
    JSON.stringify({
      version: 1,
      enabled: true,
      keyId: keyIdOf(key),
      lastBackupAt: "2026-09-20T00:00:00Z",
    }),
  );
  expect((await p.state.readRemoteState())?.deviceId).toBeUndefined();
  const me = vi.spyOn(deps.transport, "me");
  const get = vi.spyOn(deps.transport, "getManifest");
  const remove = vi.spyOn(deps.transport, "deleteManifest");
  expect(await p.family.leaveFamily(deps)).toEqual({ removedRemote: true });
  expect(me).toHaveBeenCalledOnce();
  expect(get).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledWith("A", undefined);
  expect(remote.manifests.size).toBe(0);
  expect(await p.state.loadKey()).toBeNull();
  expect(fs.readdirSync(p.state.syncDirectory.uri)).toEqual([]);
});
it("同成员两台手机同步靠 me 认本机，seen 与设备数不受清单回退影响", async () => {
  const remote = fakeRemote();
  const a = await phone();
  await a.add("a");
  const publishedA = await a.engine.pushManifest(a.store.get(), {
    transport: remote.client("A", "主人"),
    key,
  });
  const p = await phone();
  await p.add("b");
  const deps = { transport: remote.client("B", "主人"), key };
  const fallback = await deps.transport.getManifest();
  expect(fallback?.deviceId).toBe("A");
  // 即使身份查询时拿到的是同成员 A 的清单，也不能拿它来认本机。
  const get = vi.spyOn(deps.transport, "getManifest").mockResolvedValue(fallback);
  const me = vi.spyOn(deps.transport, "me");
  const signal = new AbortController().signal;
  const result = await p.family.joinFamily(p.store, key, { ...deps, signal });
  const publishedB = p.engine.parseIndex(
    openSmall(key, p.engine.INDEX_LABEL, fromBase64(remote.manifests.get("B")!.index)),
  );
  expect(publishedB.sha256).not.toBe(publishedA.index.sha256);
  expect(result.seen).toEqual({ A: publishedA.index.sha256, B: publishedB.sha256 });
  expect(result.deviceId).toBe("B");
  expect(result.lastSyncSummary?.devices).toBe(2);
  expect(await p.state.readRemoteState()).toEqual(result);
  expect(me).toHaveBeenCalledExactlyOnceWith(signal);
  expect(get).not.toHaveBeenCalled();
});
it("同步成功记住本机设备 ID，退出直接删除它且保留同成员其他手机", async () => {
  const remote = fakeRemote();
  const a = await phone();
  await a.add("a");
  await a.engine.pushManifest(a.store.get(), {
    transport: remote.client("A", "主人"),
    key,
  });
  const p = await phone();
  const deps = { transport: remote.client("B", "主人"), key };
  const result = await p.family.joinFamily(p.store, key, deps);
  expect(result.deviceId).toBe("B");
  expect((await p.state.readRemoteState())?.deviceId).toBe("B");
  const me = vi.spyOn(deps.transport, "me").mockRejectedValue(
    new Error("有本机 ID 时不应再查询身份"),
  );
  const get = vi.spyOn(deps.transport, "getManifest").mockRejectedValue(
    new Error("有本机 ID 时不应查询清单"),
  );
  const list = vi.spyOn(deps.transport, "manifests").mockRejectedValue(
    new Error("有本机 ID 时不应查询清单列表"),
  );
  const remove = vi.spyOn(deps.transport, "deleteManifest");
  expect(await p.family.leaveFamily(deps)).toEqual({ removedRemote: true });
  expect(me).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
  expect(list).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledWith("B", undefined);
  expect(remote.manifests.has("A")).toBe(true);
  expect(remote.manifests.has("B")).toBe(false);
});
it.each(["LAST_ADMIN_DEVICE", "NETWORK"])("服务端因 %s 没有确认设备退出时保留内容钥匙与同步状态", async (code) => {
  const { receiver: p, deps } = await seeded();
  await p.family.joinFamily(p.store, key, deps);
  const previous = await p.state.readRemoteState();
  const error = Object.assign(new Error("退出未确认"), { code });
  const revokeDevice = vi.fn(async () => {
    expect(await p.state.loadKey()).toEqual(key);
    throw error;
  });
  await expect(p.family.leaveFamily({ ...deps, revokeDevice })).rejects.toBe(error);
  expect(revokeDevice).toHaveBeenCalledOnce();
  expect(await p.state.loadKey()).toEqual(key);
  expect(await p.state.readRemoteState()).toEqual(previous);
  expect(Object.keys(p.store.get().records)).toHaveLength(2);
});
it.each([
  "NETWORK",
  "TIMEOUT",
  "AUTH_REQUIRED",
  "NOT_FOUND",
  "ADMIN_ONLY",
  "SERVER_ERROR",
])("退出时 %s 按约定决定是否清除本机状态", async (code) => {
  const { receiver: p, deps } = await seeded();
  await p.family.joinFamily(p.store, key, deps);
  const { SyncError } = await import("../src/sync/transport");
  deps.transport.deleteManifest = async () => {
    throw new SyncError(code, "删除失败");
  };
  const recoverable = [
    "NETWORK",
    "TIMEOUT",
    "AUTH_REQUIRED",
    "NOT_FOUND",
  ].includes(code);
  if (recoverable) {
    expect(await p.family.leaveFamily(deps)).toEqual({ removedRemote: false });
    expect(await p.state.loadKey()).toBeNull();
    expect(fs.readdirSync(p.state.syncDirectory.uri)).toEqual(["conflicts.json"]);
  } else {
    await expect(p.family.leaveFamily(deps)).rejects.toMatchObject({ code });
    expect(await p.state.loadKey()).toEqual(key);
    expect(await p.state.readRemoteState()).not.toBeNull();
    expect(fs.readdirSync(p.state.syncDirectory.uri)).toHaveLength(4);
  }
  expect(Object.keys(p.store.get().records)).toHaveLength(2);
});
it("上传失败仍保留新旧冲突，同一实体只留最新一次，重试不会丢字", async () => {
  const { receiver: p, deps } = await seeded();
  await p.add("a", "本机的旧版本", "外婆", false);
  await p.store.change((s) => {
    s.records["r-a"] = {
      ...s.records["r-a"]!,
      updatedAt: "2026-09-19T00:00:00Z",
    };
  });
  const old = {
    key: "records:old",
    kind: "records" as const,
    entityId: "old",
    at: "2026-09-18T00:00:00Z",
    device: null,
    winner: { updatedAt: "2026-09-18T00:00:00Z" },
    loser: { ...p.store.get().records["r-a"]!, mediaIds: [], id: "old" },
  };
  p.state.writeRemoteState(p.state.freshRemoteState(keyIdOf(key)));
  p.state.writeConflicts([
    old,
    {
      ...old,
      key: "records:r-a",
      entityId: "r-a",
      loser: { ...p.store.get().records["r-a"]!, mediaIds: [] },
    },
  ]);
  const put = deps.transport.put;
  deps.transport.put = async () => {
    throw new Error("上传失败");
  };
  await expect(p.family.joinFamily(p.store, key, deps)).rejects.toThrow(
    "上传失败",
  );
  expect(p.store.get().records["r-a"]?.text).toBe("她笑了");
  const conflicts = await p.state.readConflicts();
  expect(conflicts).toHaveLength(2);
  expect(conflicts.find((c) => c.key === "records:old")).toEqual(old);
  expect(conflicts.find((c) => c.key === "records:r-a")?.loser.text).toBe(
    "本机的旧版本",
  );
  deps.transport.put = put;
  await p.family.runFamilySync(p.store, deps);
  expect(await p.state.readConflicts()).toEqual(conflicts);
});
it("合并写入本机后上传失败：基与已读清单已跟上，改了拉来的时光再同步不出假冲突、不重下", async () => {
  const { receiver: p, remote, deps, published } = await seeded();
  const put = deps.transport.put;
  deps.transport.put = async () => {
    throw new Error("上传失败");
  };
  await expect(p.family.joinFamily(p.store, key, deps)).rejects.toThrow(
    "上传失败",
  );
  expect(p.store.get().records["r-a"]?.text).toBe("她笑了");
  await p.store.change((s) => {
    s.records["r-a"] = {
      ...s.records["r-a"]!,
      text: "她笑了，还拍了手",
      updatedAt: "2026-09-23T00:00:00Z",
    };
  });
  deps.transport.put = put;
  remote.log.length = 0;
  const result = await p.family.runFamilySync(p.store, deps);
  expect(await p.state.readConflicts()).toEqual([]);
  expect(result.lastSyncSummary!.conflicts).toBe(0);
  expect(p.store.get().records["r-a"]?.text).toBe("她笑了，还拍了手");
  expect(remote.log).not.toContain(
    `get ${objectIdOf(key, published.index.sha256, 0)}`,
  );
});
it("物化生成缩略图途中失败，清掉本轮原件与半张缩略图", async () => {
  const { receiver: p, deps } = await seeded();
  const before = p.store.get();
  vi.spyOn(p.files, "renderThumb").mockRejectedValueOnce(
    new Error("缩略图写失败"),
  );
  await expect(p.family.joinFamily(p.store, key, deps)).rejects.toThrow(
    "缩略图写失败",
  );
  expect(p.store.get()).toBe(before);
  expect(directoryBytes(p.files.mediaDirectory.uri)).toEqual({});
  expect(p.backup.collectBlobs()).toEqual({ removed: 0, bytes: 0 });
});
it("物化完后停止仍不写库，文件回到原样", async () => {
  const { receiver: p, deps } = await seeded();
  const abort = new AbortController();
  const before = p.store.get();
  await expect(
    p.family.joinFamily(p.store, key, {
      ...deps,
      signal: abort.signal,
      onProgress: (stage) => {
        if (stage === "正在写入本机资料…") abort.abort();
      },
    }),
  ).rejects.toMatchObject({ code: "CANCELED" });
  expect(p.store.get()).toBe(before);
  expect(directoryBytes(p.files.mediaDirectory.uri)).toEqual({});
});

it("阅读页标「第一次」带上世系：别的手机没解决的冲突卡不被假冲突顶掉", async () => {
  const remote = fakeRemote();
  const a = await phone();
  const depsA = { transport: remote.client("A"), key };
  await a.add("a", "她笑了", "爸爸", false);
  const edit = async (p: typeof a, text: string, at: string) =>
    p.store.change((s) => {
      const r = s.records["r-a"]!;
      s.drafts.e = { id: "e", recordId: r.id, baseRevision: r.revision, updatedAt: at,
        content: { ...p.model.clone(r), mediaIds: [...r.mediaIds], text } };
      p.model.saveRecord(s, "e", r.id, at);
    });
  await edit(a, "她笑了，第一次出声", "2026-09-20T01:00:00.000Z");
  await a.family.joinFamily(a.store, key, depsA);
  const b = await phone();
  const depsB = { transport: remote.client("B"), key };
  await b.family.joinFamily(b.store, key, depsB);
  expect(b.store.get().records["r-a"]?.text).toBe("她笑了，第一次出声");
  // Concurrent edits: B's is newer and is published first.
  a.activate();
  await edit(a, "爸爸写的：她笑出了声，像小鸭子", "2026-09-20T04:00:00.000Z");
  b.activate();
  await edit(b, "妈妈写的：她笑了", "2026-09-20T05:00:00.000Z");
  await b.family.runFamilySync(b.store, depsB);
  a.activate();
  await a.family.runFamilySync(a.store, depsA);
  const genuine = await a.state.readConflicts();
  expect(genuine.map((c) => (c.loser as { text: string }).text)).toEqual(["爸爸写的：她笑出了声，像小鸭子"]);
  // B marks the record 第一次 on the reading page (patchRecord), syncs; A syncs later without touching the card.
  b.activate();
  await b.family.runFamilySync(b.store, depsB);
  await b.store.change((s) => b.model.patchRecord(s, "r-a", { first: true }, "2026-09-20T06:00:00.000Z"));
  await b.family.runFamilySync(b.store, depsB);
  a.activate();
  await a.family.runFamilySync(a.store, depsA);
  expect(a.store.get().records["r-a"]?.first).toBe(true);
  // A never resolved its card: the losing text must still be recoverable.
  const after = await a.state.readConflicts();
  expect(after.map((c) => (c.loser as { text: string }).text)).toContain("爸爸写的：她笑出了声，像小鸭子");
}, 30000);
it("只改了年度寄语或宝宝资料（库根，不是实体）也要重新发布", async () => {
  const { receiver: p, deps } = await seeded();
  await p.family.joinFamily(p.store, key, deps);
  await p.store.change((s) => {
    s.yearNotes = { ...s.yearNotes, "2026": "这一年你学会了走路" };
  });
  const publish = vi.spyOn(deps.transport, "putManifest");
  await p.family.runFamilySync(p.store, deps);
  expect(publish).toHaveBeenCalledTimes(1);
  publish.mockClear();
  await p.store.change((s) => {
    s.profile = { ...s.profile, motto: "入淮清洛渐漫漫" };
  });
  await p.family.runFamilySync(p.store, deps);
  expect(publish).toHaveBeenCalledTimes(1);
  // 只改本机设置（主题）不算要发布的内容。
  publish.mockClear();
  await p.store.change((s) => {
    s.settings = { ...s.settings, theme: "dark" };
  });
  await p.family.runFamilySync(p.store, deps);
  expect(publish).not.toHaveBeenCalled();
});
// 「没变就不发布」的指纹只看合并的根字段，漏了装订时刻与墓碑：只改了它们的手机一直不发布
it.each(["装订了年度册", "多了一块墓碑"])("只%s：照样重新发布，家人那边并得到", async (what) => {
  const { receiver: p, sender, remote, deps } = await seeded();
  const first = await p.family.joinFamily(p.store, key, deps);
  await p.store.change((s) => {
    if (what === "装订了年度册") s.yearBooksBoundAt = { "2025": "2026-01-02T00:00:00.000Z" };
    else s.tombstones = { ...s.tombstones, "records:r-gone": "2026-09-21T00:00:00.000Z" };
  });
  const publish = vi.spyOn(deps.transport, "putManifest");
  const second = await p.family.runFamilySync(p.store, deps);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(second.lastPush!.entitiesSha).not.toBe(first.lastPush!.entitiesSha);
  sender.activate();
  await sender.family.joinFamily(sender.store, key, { transport: remote.client("爸爸手机") });
  if (what === "装订了年度册")
    expect(sender.store.get().yearBooksBoundAt).toEqual({ "2025": "2026-01-02T00:00:00.000Z" });
  else expect(sender.store.get().tombstones?.["records:r-gone"]).toBe("2026-09-21T00:00:00.000Z");
  // 再同步一次：没有新改动就不再发布。
  p.activate();
  publish.mockClear();
  await p.family.runFamilySync(p.store, deps);
  expect(publish).not.toHaveBeenCalled();
});
// 本机设置（每天的小问题、默认落款、锁、外观）、选片、提醒卡、收到的分享、导出时刻都随清单发给了全家
it("本机自己的设置与状态不进家里的清单；只改它们不重新发布", async () => {
  const { receiver: p, deps } = await seeded();
  await p.add("c", "这台手机的一段", "妈妈");
  await p.store.change((s) => {
    s.settings = {
      theme: "dark",
      largeText: true,
      lockEnabled: true,
      by: "妈妈",
      dailyQuestion: { requestedDay: "2026-09-20", day: "2026-09-20", question: "只给这台手机的问题", asked: [] },
    };
    s.selections.q = { id: "q", albumId: null, selected: ["r-c"], month: "2026-09", offset: 0, name: "九月", coverId: "m-c" };
    s.nudgeClosedAt = { book: "2026-09-20T00:00:00.000Z" };
    s.receivedShares = ["share-1"];
    s.lastExportAt = "2026-09-20T00:00:00.000Z";
  });
  const first = await p.family.joinFamily(p.store, key, deps);
  const { meta, entities } = await p.engine.fetchManifestOf((await deps.transport.getManifest())!, deps);
  const { decodeLibraryV2 } = await import("../src/local/backup-format");
  const published = decodeLibraryV2(meta, entities);
  // 旧版解码按空库补齐缺的键再校验：设备字段发的是空库的默认值，键都在。
  expect(meta.root).toMatchObject({ settings: { theme: "auto", largeText: false }, receivedShares: [], revision: 0 });
  expect(Object.keys(meta.root).sort()).toEqual(
    ["profile", "receivedShares", "revision", "settings", "version", "welcome", "yearCovers", "yearNotes"],
  );
  expect(published.selections).toEqual({});
  expect(Object.keys(published.records).sort()).toEqual(["r-a", "r-b", "r-c"]);
  expect(Object.keys(published.media).sort()).toEqual(["m-a", "m-b", "m-c"]);
  // 本机的一样没动。
  expect(p.store.get().settings.by).toBe("妈妈");
  expect(Object.keys(p.store.get().selections)).toEqual(["q"]);
  // 只改本机设置：发出去的内容没变，不重新发布。
  await p.store.change((s) => {
    s.settings = { ...s.settings, theme: "light", by: "外婆" };
    s.lastExportAt = "2026-09-25T00:00:00.000Z";
  });
  const publish = vi.spyOn(deps.transport, "putManifest");
  const second = await p.family.runFamilySync(p.store, deps);
  expect(publish).not.toHaveBeenCalled();
  expect(second.lastPush).toEqual(first.lastPush);
});
// 清单发布之后回收失败，整轮报错、下一轮再发布一次
it("清单已发布、回收失败：这一轮照常算成功，下一轮不再重发", async () => {
  const { receiver: p, deps } = await seeded();
  await p.family.joinFamily(p.store, key, deps);
  await p.add("c", "新的一段", "妈妈");
  const { SyncError } = await import("../src/sync/transport");
  const prune = vi.spyOn(deps.transport, "prune").mockRejectedValueOnce(new SyncError("NETWORK", "现在连不上服务。"));
  const publish = vi.spyOn(deps.transport, "putManifest");
  const done = await p.family.runFamilySync(p.store, deps);
  expect(prune).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenCalledOnce();
  expect(done.lastError).toBeUndefined();
  expect(done.lastPush!.manifestSha).toBe(done.seen[done.deviceId!]);
  publish.mockClear();
  await p.family.runFamilySync(p.store, deps);
  expect(publish).not.toHaveBeenCalled();
});
// 退出时先撤下清单再作废设备：服务拒绝作废时，这台留在家里却没有清单
it("撤下清单后服务没让退出：马上发回一份，钥匙与同步状态照旧；发不回也照样报原来的错", async () => {
  const { receiver: p, remote, deps } = await seeded();
  const joined = await p.family.joinFamily(p.store, key, deps);
  const error = Object.assign(new Error("这是最后一台管理者手机。"), { code: "LAST_ADMIN_DEVICE" });
  const republish = vi.fn(async () => {
    expect(remote.manifests.has("妈妈手机")).toBe(false);
    await p.family.runFamilySync(p.store, deps);
  });
  await expect(
    p.family.leaveFamily({ ...deps, revokeDevice: async () => { throw error; }, republish }),
  ).rejects.toBe(error);
  expect(republish).toHaveBeenCalledOnce();
  expect(remote.manifests.has("妈妈手机")).toBe(true);
  expect(await p.state.loadKey()).toEqual(key);
  expect((await p.state.readRemoteState())?.lastPush?.entitiesSha).toBe(joined.lastPush!.entitiesSha);
  // 发回也失败（例如断网）：不吞掉原来的错误，下一轮同步照常整份发布。
  const failing = vi.fn(async () => { throw new Error("断网"); });
  await expect(
    p.family.leaveFamily({ ...deps, revokeDevice: async () => { throw error; }, republish: failing }),
  ).rejects.toBe(error);
  expect(failing).toHaveBeenCalledOnce();
  expect(remote.manifests.has("妈妈手机")).toBe(false);
  const publish = vi.spyOn(deps.transport, "putManifest");
  await p.family.runFamilySync(p.store, deps);
  expect(publish).toHaveBeenCalledOnce();
  expect(remote.manifests.has("妈妈手机")).toBe(true);
});
it("清单没撤下（远端本来就没有）又没退成：不发回", async () => {
  const { receiver: p, deps } = await seeded();
  await p.family.joinFamily(p.store, key, deps);
  await deps.transport.deleteManifest("妈妈手机");
  const republish = vi.fn(async () => {});
  const error = new Error("退出未确认");
  await expect(
    p.family.leaveFamily({ ...deps, revokeDevice: async () => { throw error; }, republish }),
  ).rejects.toBe(error);
  expect(republish).not.toHaveBeenCalled();
});
it("标上「第一次」又取消：经过远端与 base.json，另一台跟上，之后不再来回", async () => {
  const remote = fakeRemote();
  const a = await phone();
  const depsA = { transport: remote.client("A"), key };
  await a.add("a", "她走了三步", "爸爸", false);
  await a.family.joinFamily(a.store, key, depsA);
  const b = await phone();
  const depsB = { transport: remote.client("B"), key };
  await b.family.joinFamily(b.store, key, depsB);
  a.activate();
  await a.family.runFamilySync(a.store, depsA);
  const mark = async (first: boolean, at: string) => {
    a.activate();
    await a.store.change((s) => a.model.patchRecord(s, "r-a", { first }, at));
    await a.family.runFamilySync(a.store, depsA);
    b.activate();
    await b.family.runFamilySync(b.store, depsB);
    return b.store.get().records["r-a"]?.first;
  };
  expect(await mark(true, "2026-09-21T00:00:00.000Z")).toBe(true);
  expect(await mark(false, "2026-09-22T00:00:00.000Z")).toBe(false);
  expect(await b.state.readConflicts()).toEqual([]);
  for (const [p, deps] of [[a, depsA], [b, depsB], [a, depsA]] as const) {
    p.activate();
    const state = await p.family.runFamilySync(p.store, deps);
    expect(state.lastSyncSummary!.pulled).toBe(0);
  }
}, 30000);
// 已知局限：名字、人物这些没有时间戳的值改回见过的一枚传不开。曾试过按「各台上次发布的值」认出改回去，
// 三台以上会把别人的采纳也当成新改动、来回翻个不停（复审 2026-09-26），撤掉了。这里钉住：怎么同步都会停下来。
it("三台里一台改名、同步、没等下一轮又改回：之后几轮都安静下来，不来回翻、不反复发布", async () => {
  const remote = fakeRemote();
  const a = await phone();
  const depsA = { transport: remote.client("A"), key };
  await a.store.change((s) => {
    s.profile = { ...s.profile, name: "桉桉" };
  });
  await a.family.joinFamily(a.store, key, depsA);
  const b = await phone();
  const depsB = { transport: remote.client("B"), key };
  await b.family.joinFamily(b.store, key, depsB);
  const c = await phone();
  const depsC = { transport: remote.client("C"), key };
  await c.family.joinFamily(c.store, key, depsC);
  const all = [[a, depsA], [b, depsB], [c, depsC]] as const;
  for (const [p, deps] of all) {
    p.activate();
    await p.family.runFamilySync(p.store, deps);
  }
  b.activate();
  await b.store.change((s) => {
    s.profile = { ...s.profile, name: "清洛" };
  });
  await b.family.runFamilySync(b.store, depsB);
  await b.store.change((s) => {
    s.profile = { ...s.profile, name: "桉桉" };
  });
  let last = "";
  for (let round = 0; round < 6; round++) {
    const line: string[] = [];
    for (const [p, deps] of all) {
      p.activate();
      const st = await p.family.runFamilySync(p.store, deps);
      line.push(`${st.lastSyncSummary!.pulled}/${st.lastSyncSummary!.pushed}`);
    }
    last = line.join(" ");
  }
  expect(last).toBe("0/0 0/0 0/0");
}, 60000);
