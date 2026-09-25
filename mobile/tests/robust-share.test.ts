import { beforeEach, afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DatabaseSync } from "node:sqlite";
import type { NativeShareManifest } from "../modules/share-intake/src";
const env = vi.hoisted(() => ({
  root: "",
  free: Number.POSITIVE_INFINITY,
  shares: [] as NativeShareManifest[],
  acknowledged: [] as string[],
  rejectActivation: false,
  failThumb: false,
  database: null as DatabaseSync | null,
  enospcFrom: "",
}));
vi.mock("../modules/share-intake/src", () => ({
  consumePendingNativeShares: async () => env.shares,
  acknowledgeNativeShare: async (id: string) => {
    env.acknowledged.push(id);
  },
}));
vi.mock("expo-crypto", async () => ({
  randomUUID: (await import("node:crypto")).randomUUID,
}));
vi.mock("expo-sharing", () => ({
  isAvailableAsync: async () => true,
  shareAsync: async () => {},
}));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked" }));
vi.mock("expo-image-manipulator", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  return {
    SaveFormat: { JPEG: "jpeg" },
    manipulateAsync: async () => {
      if (env.failThumb) throw new Error("thumbnail failed");
      const p = path.join(env.root, "cache-thumb.jpg");
      fs.writeFileSync(p, "thumb-bytes");
      return { uri: p, width: 512, height: 384 };
    },
  };
});
vi.mock("expo-video-thumbnails", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  return {
    getThumbnailAsync: async () => {
      if (env.failThumb) throw new Error("thumbnail failed");
      const p = path.join(env.root, "cache-vthumb.jpg");
      fs.writeFileSync(p, "vthumb-bytes");
      return { uri: p, width: 640, height: 480 };
    },
  };
});
vi.mock("expo-file-system", async () => {
  const fake = (await import("./helpers/expo-file-system-fake")).createExpoFileSystemFake(env);
  const copy = fake.File.prototype.copy;
  // Disk full while copying one particular source.
  fake.File.prototype.copy = async function (this: { uri: string }, to: never, options?: never) {
    if (env.enospcFrom && this.uri.endsWith(env.enospcFrom))
      throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    return copy.call(this, to, options);
  };
  return fake;
});
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async (name: string) => {
    const db = new DatabaseSync(path.join(env.root, name));
    env.database = db;
    const driver = {
      execAsync: async (sql: string) => {
        db.exec(sql);
      },
      getFirstAsync: async (sql: string) => db.prepare(sql).get(),
      getAllAsync: async (sql: string) => db.prepare(sql).all(),
      runAsync: async (sql: string, ...args: (string | number)[]) =>
        db.prepare(sql).run(...args),
      closeAsync: async () => {
        db.close();
        if (env.database === db) env.database = null;
      },
      withExclusiveTransactionAsync: async (
        fn: (tx: unknown) => Promise<void>,
      ) => {
        db.exec("BEGIN IMMEDIATE");
        try {
          await fn(driver);
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      },
    };
    return driver;
  },
}));
beforeEach(() => {
  vi.resetModules();
  env.free = Number.POSITIVE_INFINITY;
  env.rejectActivation = false;
  env.failThumb = false;
  env.enospcFrom = "";
  env.shares = [];
  env.acknowledged = [];
  env.root = fs.mkdtempSync(path.join(os.tmpdir(), "anan-test-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  env.database?.close();
  env.database = null;
  fs.rmSync(env.root, { recursive: true, force: true });
});

async function open() {
  const { openLocalStore } = await import("../src/local/disk");
  const files = await import("../src/local/files");
  const store = await openLocalStore();
  files.ensureDirectories();
  return { store, files };
}
const originalsDir = () => `${env.root.replace(/\\/g, "/")}/anan-v1/intake/originals`;
function queueShare(manifestId: string, name: string, bytes: Buffer) {
  const original = `${originalsDir()}/${name}`;
  fs.mkdirSync(path.dirname(original), { recursive: true });
  fs.writeFileSync(original, bytes);
  env.shares = [
    {
      manifestId,
      source: "share",
      createdAt: new Date().toISOString(),
      complete: true,
      items: [
        {
          externalId: "shared",
          captureId: "capture",
          kind: "file",
          localUri: original,
          fileName: name,
          mediaType: "image",
        },
      ],
    },
  ];
  return original;
}
it("frees the intake original once a shared photo is committed and acknowledged", async () => {
  const { store } = await open();
  const { receiveShares } = await import("../src/local/services");
  const original = queueShare("11111111-1111-4111-8111-111111111111", "big.jpg", Buffer.alloc(4096, 7));
  await receiveShares(store);
  expect(Object.values(store.get().drafts)).toHaveLength(1);
  expect(env.acknowledged).toHaveLength(1);
  // The photo now lives in media/; nothing ever deletes intake/originals/big.jpg,
  // so every shared photo/video occupies twice its size forever.
  expect(fs.existsSync(original)).toBe(false);
});
it("does not acknowledge (and so drop) a shared photo when the copy failed only because the disk was full", async () => {
  const { store } = await open();
  const { receiveShares } = await import("../src/local/services");
  queueShare("22222222-2222-4222-8222-222222222222", "full.jpg", Buffer.alloc(4096, 8));
  env.enospcFrom = "full.jpg";
  await expect(receiveShares(store)).rejects.toThrow();
  // Today the ENOSPC is counted as an "unusable item", the manifest is acknowledged
  // and the share is gone for good: freeing space and reopening the app brings nothing back.
  expect(env.acknowledged).toEqual([]);
  env.enospcFrom = "";
  await receiveShares(store);
  expect(Object.values(store.get().drafts)).toHaveLength(1);
});
it("does not leave unreferenced copies in media/ when two receive passes overlap (foreground drain + 「重试接收」)", async () => {
  const { store, files } = await open();
  const { receiveShares } = await import("../src/local/services");
  queueShare("33333333-3333-4333-8333-333333333333", "twice.jpg", Buffer.alloc(4096, 9));
  await Promise.all([receiveShares(store), receiveShares(store)]);
  expect(Object.values(store.get().drafts)).toHaveLength(1);
  const referenced = new Set(
    Object.values(store.get().media).flatMap((m) => [m.file, ...(m.thumb ? [m.thumb] : [])]),
  );
  const onDisk = fs.readdirSync(files.mediaDirectory.uri);
  // The losing pass sees receivedShares already contains the id, returns without
  // touching the library, and never deletes the originals it just copied.
  expect(onDisk.filter((name) => !referenced.has(name))).toEqual([]);
});
