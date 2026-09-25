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
vi.mock("expo-file-system", async () =>
  (await import("./helpers/expo-file-system-fake")).createExpoFileSystemFake(
    env,
  ),
);
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
async function setup() {
  const files = await import("../src/local/files");
  const backup = await import("../src/local/backup");
  const { openLocalStore } = await import("../src/local/disk");
  const model = await import("../src/local/model");
  const store = await openLocalStore();
  files.ensureDirectories();
  const original = path.join(env.root, "source.jpg");
  fs.writeFileSync(original, Buffer.alloc(600000, 17));
  const media = await files.preserveMedia(original, "成长照片.jpg", "image");
  await store.change((s) => {
    s.welcome = true;
    s.media[media.id] = media;
    s.profile.name = "宝宝";
    s.drafts.d = {
      id: "d",
      recordId: null,
      baseRevision: 0,
      updatedAt: new Date().toISOString(),
      content: {
        ...model.emptyContent(),
        text: "第一步",
        mediaIds: [media.id],
        coverId: media.id,
      },
    };
    model.saveRecord(s, "d", "r", new Date().toISOString());
    s.albums.a = {
      id: "a",
      name: "一年",
      items: [{ id: "i", recordId: "r" }],
      coverId: media.id,
      updatedAt: new Date().toISOString(),
    };
  });
  return { files, backup, store, model, media };
}

it("recovers from a same-size corrupted blob: the next full backup can be exported again", async () => {
  const { store, backup, files, media } = await setup();
  const exporter = await import("../src/local/backup-export");
  const first = await backup.createBackup(store.get());
  // Storage-level damage after the blob was verified and renamed (flash bit rot, torn page):
  // same length, different bytes. The original in media/ is still intact.
  const blob = files.blobFile(media.sha256).uri;
  const bytes = fs.readFileSync(blob);
  bytes[0] = bytes[0]! ^ 0xff;
  fs.writeFileSync(blob, bytes);
  await expect(exporter.writeVolume(exporter.planExport(first), 0)).rejects.toThrow("校验失败");
  // She taps 「保存完整备份」 again. ensureBlob trusts any blob whose *size* matches, so the
  // damaged copy is never replaced from the intact original; every later backup, export and
  // family upload (which reads blobs without hashing) keeps using it.
  const second = await backup.createBackup(store.get());
  const volume = await exporter.writeVolume(exporter.planExport(second), 0);
  expect(volume.exists).toBe(true);
});
