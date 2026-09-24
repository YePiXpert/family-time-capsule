import { contentHashOf } from "../src/local/hash";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DatabaseSync } from "node:sqlite";
import type { NativeShareManifest } from "../modules/share-intake/src";
import { clone, deleteSeries, emptyLibrary, ENTITY_KINDS, type Library } from "../src/local/model";
import { LocalStore } from "../src/local/store";
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
/** 把实体表拼回整库，和 disk.read() 同一套拼法。 */
function readLibrary(db: DatabaseSync): Record<string, unknown> | null {
  const root = db.prepare("SELECT json FROM root WHERE id=1").get() as
    { json: string } | undefined;
  if (!root) return null;
  const state = JSON.parse(root.json) as Record<string, unknown>;
  for (const kind of ENTITY_KINDS) state[kind] = {};
  const rows = db.prepare("SELECT kind,id,json FROM entity").all() as {
    kind: string;
    id: string;
    json: string;
  }[];
  for (const row of rows)
    (state[row.kind] as Record<string, unknown>)[row.id] = JSON.parse(row.json);
  return state;
}
it("runs production SQLite writes and reopens its complete snapshot", async () => {
  const { store } = await setup();
  expect(readLibrary(env.database!)).toEqual(store.get());
  expect(store.get().records.r?.text).toBe("第一步");
});
it("moves a Build 62 single-row library into entity tables on open", async () => {
  const { store } = await setup();
  const before = store.get();
  // 造一个旧库：整库塞回 library 单行，清空实体表。
  env.database!.exec("DELETE FROM entity; DELETE FROM root;");
  env
    .database!.prepare("INSERT INTO library(id,snapshot) VALUES(1,?)")
    .run(JSON.stringify(before));
  env.database!.close();
  env.database = null;
  vi.resetModules();
  const { openLocalStore } = await import("../src/local/disk");
  const reopened = await openLocalStore();
  expect(reopened.get()).toEqual(before);
  // 切代完成后旧单行退场，之后只读实体表。
  expect(env.database!.prepare("SELECT COUNT(*) n FROM library").get()).toEqual(
    { n: 0 },
  );
  expect(readLibrary(env.database!)).toEqual(before);
});
it("exports and restores real original bytes and relationships with a before-restore backup", async () => {
  const { store, backup, files, model, media } = await setup();
  const out = await backup.createBackup(store.get());
  await store.change((s) => {
    model.deleteRecord(s, "r");
    s.profile.name = "changed";
  });
  const before = await backup.restoreBackup(store, out);
  expect(store.get().records.r?.text).toBe("第一步");
  expect(store.get().albums.a?.items[0]?.recordId).toBe("r");
  expect(store.get().profile.name).toBe("宝宝");
  expect(
    fs.readFileSync(files.mediaFile(store.get().media[media.id]!).uri),
  ).toEqual(Buffer.alloc(600000, 17));
  expect((await backup.inspectBackup(before)).profile.name).toBe("changed");
});
it("a restore drops the deletion markers made since the backup and the files it replaced", async () => {
  const { store, backup, files, model, media } = await setup();
  const out = await backup.createBackup(store.get());
  const oldFile = files.mediaFile(media).uri;
  await store.change((s) => {
    model.deleteRecord(s, "r");
  });
  expect(store.get().tombstones?.["records:r"]).toBeTruthy();
  await backup.restoreBackup(store, out);
  expect(store.get().records.r?.text).toBe("第一步");
  // 留着恢复前的墓碑，下次家人同步会把刚恢复的记录再删掉。
  expect(store.get().tombstones?.["records:r"]).toBeUndefined();
  const restored = store.get().media[media.id]!;
  expect(files.mediaFile(restored).uri).not.toBe(oldFile);
  expect(fs.existsSync(oldFile)).toBe(false);
  expect(fs.readFileSync(files.mediaFile(restored).uri)).toEqual(Buffer.alloc(600000, 17));
});
it("rejects an altered, lost or truncated backup before changing current data", async () => {
  const { store, backup, files, media } = await setup();
  const out = await backup.createBackup(store.get());
  const blob = files.blobFile(media.sha256).uri;
  const bytes = fs.readFileSync(blob);
  bytes[bytes.length - 1] = 0;
  fs.writeFileSync(blob, bytes);
  const revision = store.get().revision;
  await expect(backup.restoreBackup(store, out)).rejects.toThrow("校验失败");
  expect(store.get().revision).toBe(revision);
  fs.unlinkSync(blob);
  await expect(backup.inspectBackup(out)).rejects.toThrow("已不在本机");
  const manifest = fs.readFileSync(out.uri);
  fs.writeFileSync(out.uri, manifest.subarray(0, manifest.length - 2));
  await expect(backup.inspectBackup(out)).rejects.toThrow("不完整");
  // 实体 JSON 坏了一个字节：报的是人话，不是解析器的英文原话。
  manifest[manifest.length - 2] = 0x21;
  fs.writeFileSync(out.uri, manifest);
  await expect(backup.inspectBackup(out)).rejects.toThrow("备份内容损坏");
});
it("refuses to call a missing original a successful complete backup", async () => {
  const { store, backup, files, media } = await setup();
  fs.unlinkSync(files.mediaFile(media).uri);
  await expect(backup.createBackup(store.get())).rejects.toThrow("素材缺失");
  expect(fs.readdirSync(files.backupDirectory.uri)).toEqual([]);
});
it("failed database commit rolls back the library and removes extracted new files", async () => {
  const { store, backup, files } = await setup();
  const out = await backup.createBackup(store.get());
  const count = fs.readdirSync(files.mediaDirectory.uri).length;
  env.database!.exec(
    "CREATE TRIGGER reject_update BEFORE UPDATE ON root BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
  );
  const before = JSON.stringify(store.get());
  await expect(backup.restoreBackup(store, out)).rejects.toThrow("disk full");
  expect(JSON.stringify(store.get())).toBe(before);
  expect(fs.readdirSync(files.mediaDirectory.uri)).toHaveLength(count);
});
it.each(["xmbm", "xmb", "v1"])("keeps current thumbnails when %s restore cannot rebuild thumbnails or commit", async (format) => {
  const { store, backup, files, media } = await setup();
  const manifest = await backup.createBackup(store.get());
  const exporter = await import("../src/local/backup-export");
  let input = format === "xmb"
    ? await exporter.writeVolume(exporter.planExport(manifest), 0)
    : manifest;
  if (format === "v1") {
    const { File } = await import("expo-file-system");
    const { encodeHeader } = await import("../src/local/backup-format");
    input = new File(files.backupDirectory, "legacy.xmb");
    fs.writeFileSync(input.uri, Buffer.concat([
      encodeHeader(store.get()),
      fs.readFileSync(files.mediaFile(media).uri),
    ]));
  }
  const before = JSON.stringify(store.get());
  const currentFiles = fs.readdirSync(files.mediaDirectory.uri).sort();
  const thumb = files.thumbFile(media)!;
  const thumbBytes = fs.readFileSync(thumb.uri);
  // 真正走 renderThumb 吞掉渲染异常的分支，再让数据库提交失败。
  env.failThumb = true;
  env.database!.exec(
    "CREATE TRIGGER reject_update BEFORE UPDATE ON root BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
  );
  await expect(backup.restoreBackup(store, input)).rejects.toThrow("disk full");
  expect(JSON.stringify(store.get())).toBe(before);
  expect(thumb.exists).toBe(true);
  expect(fs.readFileSync(thumb.uri)).toEqual(thumbBytes);
  expect(fs.readdirSync(files.mediaDirectory.uri).sort()).toEqual(currentFiles);
});
it("keeps current thumbnails when startup recovery cannot rebuild thumbnails or activate", async () => {
  const { store, backup, files, media } = await setup();
  const input = await backup.createBackup(store.get());
  const before = JSON.stringify(store.get());
  const currentFiles = fs.readdirSync(files.mediaDirectory.uri).sort();
  const thumb = files.thumbFile(media)!;
  const thumbBytes = fs.readFileSync(thumb.uri);
  env.database!.close();
  env.database = null;
  env.failThumb = true;
  env.rejectActivation = true;
  await expect(backup.recoverStartupBackup(input)).rejects.toThrow("activation write failed");
  expect(JSON.stringify(store.get())).toBe(before);
  expect(thumb.exists).toBe(true);
  expect(fs.readFileSync(thumb.uri)).toEqual(thumbBytes);
  expect(fs.readdirSync(files.mediaDirectory.uri).sort()).toEqual(currentFiles);
  const { activeLibraryName } = await import("../src/local/activation");
  expect(await activeLibraryName()).toBe("anan-local-v1.sqlite");
});
it("still receives a share that was queued under the former directory name", async () => {
  const { store, files } = await setup();
  const { receiveShares } = await import("../src/local/services");
  const root = env.root.replace(/\\/g, "/");
  // 清单是改名前写的，记的是旧路径；文件本身已经随目录搬到新名字下了。
  const queued = `${root}/xiaomei-v1/intake/originals/shared.jpg`;
  const moved = `${root}/anan-v1/intake/originals/shared.jpg`;
  fs.mkdirSync(path.dirname(moved), { recursive: true });
  fs.writeFileSync(moved, Buffer.alloc(32, 9));
  env.shares = [
    {
      manifestId: "carried",
      source: "share",
      createdAt: new Date().toISOString(),
      complete: true,
      items: [
        {
          externalId: "shared",
          captureId: "capture",
          kind: "file",
          localUri: queued,
          fileName: "shared.jpg",
          mediaType: "image",
        },
      ],
    },
  ];
  await receiveShares(store);
  const drafts = Object.values(store.get().drafts);
  expect(drafts).toHaveLength(1);
  expect(drafts[0]!.content.mediaIds).toHaveLength(1);
  expect(fs.readdirSync(files.mediaDirectory.uri).length).toBeGreaterThan(0);
});
it("receives a native shared original once and acknowledges only its committed draft", async () => {
  const { store, files } = await setup();
  const { receiveShares } = await import("../src/local/services");
  const original = `${env.root.replace(/\\/g, "/")}/anan-v1/intake/originals/shared.jpg`;
  fs.mkdirSync(path.dirname(original), { recursive: true });
  fs.writeFileSync(original, Buffer.alloc(32, 15));
  env.shares = [
    {
      manifestId: "receipt",
      source: "share",
      createdAt: new Date().toISOString(),
      complete: true,
      items: [
        {
          externalId: "shared",
          captureId: "capture",
          kind: "file",
          localUri: original,
          fileName: "shared.jpg",
          mediaType: "image",
        },
      ],
    },
  ];
  await receiveShares(store);
  await receiveShares(store);
  const drafts = Object.values(store.get().drafts);
  expect(drafts).toHaveLength(1);
  expect(env.acknowledged).toEqual(["receipt", "receipt"]);
  const id = drafts[0]!.content.mediaIds[0]!;
  expect(fs.readFileSync(files.mediaFile(store.get().media[id]!).uri)).toEqual(
    Buffer.alloc(32, 15),
  );
});
it("skips unusable share items without poisoning their batch or later ones", async () => {
  const { store } = await setup();
  const { receiveShares } = await import("../src/local/services");
  const original = `${env.root.replace(/\\/g, "/")}/anan-v1/intake/originals/shared.jpg`;
  fs.mkdirSync(path.dirname(original), { recursive: true });
  fs.writeFileSync(original, Buffer.alloc(24, 9));
  env.shares = [
    {
      manifestId: "mixed",
      source: "share",
      createdAt: new Date().toISOString(),
      complete: true,
      items: [
        {
          externalId: "gone",
          captureId: "capture",
          kind: "error",
          error: "vanished",
        },
        {
          externalId: "shared",
          captureId: "capture",
          kind: "file",
          localUri: original,
          fileName: "shared.jpg",
          mediaType: "image",
        },
        {
          externalId: "escape",
          captureId: "capture",
          kind: "file",
          localUri: `${env.root.replace(/\\/g, "/")}/outside.jpg`,
          fileName: "outside.jpg",
          mediaType: "image",
        },
      ],
    },
    {
      manifestId: "later",
      source: "share",
      createdAt: new Date().toISOString(),
      complete: true,
      items: [
        {
          externalId: "text",
          captureId: "capture",
          kind: "text",
          text: "Later story",
        },
      ],
    },
  ];
  await expect(receiveShares(store)).rejects.toThrow("有 2 份分享素材未能保存");
  const drafts = Object.values(store.get().drafts);
  expect(drafts).toHaveLength(2);
  expect(drafts.some((d) => d.content.mediaIds.length === 1)).toBe(true);
  expect(drafts.some((d) => d.content.text === "Later story")).toBe(true);
  expect(env.acknowledged.sort()).toEqual(["later", "mixed"]);
});
it("acknowledges a share with nothing usable instead of replaying it forever", async () => {
  const { store } = await setup();
  const { receiveShares } = await import("../src/local/services");
  env.shares = [
    {
      manifestId: "broken",
      source: "share",
      createdAt: new Date().toISOString(),
      complete: true,
      items: [
        {
          externalId: "gone",
          captureId: "capture",
          kind: "error",
          error: "vanished",
        },
      ],
    },
  ];
  await expect(receiveShares(store)).rejects.toThrow("有 1 份分享素材未能保存");
  expect(Object.values(store.get().drafts)).toEqual([]);
  expect(env.acknowledged).toEqual(["broken"]);
});
it("removes copied files when the library write fails mid-batch", async () => {
  const { store, files } = await setup();
  const { receiveShares } = await import("../src/local/services");
  const original = `${env.root.replace(/\\/g, "/")}/anan-v1/intake/originals/shared.jpg`;
  fs.mkdirSync(path.dirname(original), { recursive: true });
  fs.writeFileSync(original, Buffer.alloc(24, 9));
  const before = fs.readdirSync(files.mediaDirectory.uri).length;
  env.shares = [
    {
      manifestId: "doomed",
      source: "share",
      createdAt: new Date().toISOString(),
      complete: true,
      items: [
        {
          externalId: "shared",
          captureId: "capture",
          kind: "file",
          localUri: original,
          fileName: "shared.jpg",
          mediaType: "image",
        },
      ],
    },
  ];
  env.database!.exec(
    "CREATE TRIGGER reject_share BEFORE UPDATE ON root BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
  );
  await expect(receiveShares(store)).rejects.toThrow("原接收任务已保留");
  expect(env.acknowledged).toEqual([]);
  expect(Object.values(store.get().drafts)).toEqual([]);
  expect(fs.readdirSync(files.mediaDirectory.uri)).toHaveLength(before);
});
it("applies shared capture time and place to the intake draft", async () => {
  const { store } = await setup();
  const { receiveShares } = await import("../src/local/services");
  const originals = `${env.root.replace(/\\/g, "/")}/anan-v1/intake/originals`;
  fs.mkdirSync(originals, { recursive: true });
  fs.writeFileSync(`${originals}/old.jpg`, Buffer.alloc(24, 3));
  fs.writeFileSync(`${originals}/plain.jpg`, Buffer.alloc(24, 4));
  env.shares = [
    {
      manifestId: "meta",
      source: "share",
      createdAt: new Date().toISOString(),
      complete: true,
      items: [
        {
          externalId: "old",
          captureId: "capture",
          kind: "file",
          localUri: `${originals}/old.jpg`,
          fileName: "old.jpg",
          mediaType: "image",
          capturedAt: "2025-06-01T10:20:30",
          latitude: 31.2,
          longitude: 121.5,
        },
        {
          externalId: "plain",
          captureId: "capture2",
          kind: "file",
          localUri: `${originals}/plain.jpg`,
          fileName: "plain.jpg",
          mediaType: "image",
          capturedAt: "not-a-date",
          latitude: 999,
          longitude: 999,
        },
      ],
    },
  ];
  await receiveShares(store);
  const draft = Object.values(store.get().drafts)[0]!;
  expect(draft.content.date).toBe("2025-06-01T10:20:30");
  expect(draft.content.location).toBe("31.200000, 121.500000");
  expect(Object.values(store.get().drafts)).toHaveLength(1);
  expect(draft.autoDate).toBe(false);
  expect(draft.autoLocation).toBe(false);
  expect(store.get().media[draft.content.mediaIds[0]!]!.photoMetadata).toEqual({
    capturedAt: "2025-06-01T10:20:30",
    latitude: 31.2,
    longitude: 121.5,
  });
  expect(
    store.get().media[draft.content.mediaIds[1]!]!.photoMetadata,
  ).toBeUndefined();
});
it("keeps shared photos spanning several days in one draft", async () => {
  const { store } = await setup();
  const { receiveShares } = await import("../src/local/services");
  const originals = `${env.root.replace(/\\/g, "/")}/anan-v1/intake/originals`;
  fs.mkdirSync(originals, { recursive: true });
  fs.writeFileSync(`${originals}/day1.jpg`, Buffer.alloc(24, 5));
  fs.writeFileSync(`${originals}/day2.jpg`, Buffer.alloc(24, 6));
  env.shares = [
    {
      manifestId: "days",
      source: "share",
      createdAt: new Date().toISOString(),
      complete: true,
      items: [
        {
          externalId: "day1",
          captureId: "c1",
          kind: "file",
          localUri: `${originals}/day1.jpg`,
          fileName: "day1.jpg",
          mediaType: "image",
          capturedAt: "2025-06-01T10:20:30",
        },
        {
          externalId: "day2",
          captureId: "c2",
          kind: "file",
          localUri: `${originals}/day2.jpg`,
          fileName: "day2.jpg",
          mediaType: "image",
          capturedAt: "2025-06-02T09:00:00",
        },
      ],
    },
  ];
  await receiveShares(store);
  const draft = Object.values(store.get().drafts)[0]!;
  expect(draft.content.mediaIds).toHaveLength(2);
  expect(Object.values(store.get().drafts)).toHaveLength(1);
  expect(draft).not.toHaveProperty("groupPhotosByDay");
  expect(draft).not.toHaveProperty("photoEvents");
});
it("retains the native share receipt on a failed write and safely retries", async () => {
  const { store } = await setup();
  const { receiveShares } = await import("../src/local/services");
  env.shares = [
    {
      manifestId: "receipt",
      source: "share",
      createdAt: new Date().toISOString(),
      complete: true,
      items: [
        {
          externalId: "text",
          captureId: "capture",
          kind: "text",
          text: "Shared story",
        },
      ],
    },
  ];
  env.database!.exec(
    "CREATE TRIGGER reject_share BEFORE UPDATE ON root BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
  );
  await expect(receiveShares(store)).rejects.toThrow("disk full");
  expect(env.acknowledged).toEqual([]);
  expect(Object.values(store.get().drafts)).toEqual([]);
  env.database!.exec("DROP TRIGGER reject_share");
  await receiveShares(store);
  expect(Object.values(store.get().drafts)[0]?.content.text).toBe(
    "Shared story",
  );
});
it("resumes the same material session with its input, cover and scroll position", async () => {
  const { store, media } = await setup();
  const { beginSelection } = await import("../src/local/services");
  const id = await beginSelection(store);
  const { editEntity } = await import("../src/local/model");
  await store.change((s) => {
    editEntity(s, "selections", id, (q) => {
      q.selected = ["r"];
      q.month = "2026-09";
      q.offset = 444;
      q.name = "生日";
      q.coverId = media.id;
    });
  });
  expect(await beginSelection(store, null, ["r"])).toBe(id);
  expect(store.get().selections[id]).toMatchObject({
    selected: ["r"],
    offset: 444,
    name: "生日",
    coverId: media.id,
  });
});
it("creates, reuses and renames people within the stored name limits", async () => {
  const { store } = await setup();
  const { createPerson, renamePerson } = await import("../src/local/services");
  const id = await createPerson(store, "  外婆  ");
  expect(store.get().persons[id]!.name).toBe("外婆");
  // 同名复用既有身份，不会多出一个人
  expect(await createPerson(store, "外婆")).toBe(id);
  expect(Object.keys(store.get().persons)).toEqual([id]);
  await renamePerson(store, id, "  姥姥 ");
  expect(store.get().persons[id]!.name).toBe("姥姥");
  await renamePerson(store, id, "长".repeat(60));
  expect(store.get().persons[id]!.name).toBe("长".repeat(50));
  // 空名与不存在的人都要报错，且不改动已存内容
  await expect(renamePerson(store, id, "   ")).rejects.toThrow();
  await expect(renamePerson(store, "nobody", "谁")).rejects.toThrow();
  expect(store.get().persons[id]!.name).toBe("长".repeat(50));
});
it("recovers an unreadable startup library into a verified new database and retains the original", async () => {
  const { store, backup } = await setup();
  const file = await backup.createBackup(store.get());
  env.database!.exec("UPDATE root SET json='broken' WHERE id=1");
  env.database!.close();
  env.database = null;
  await backup.recoverStartupBackup(file);
  const { activeLibraryName } = await import("../src/local/activation");
  const name = await activeLibraryName();
  expect(name).toMatch(/^anan-recovered-/);
  const recovered = new DatabaseSync(path.join(env.root, name));
  const state = readLibrary(recovered) as {
    records: Record<string, { text: string }>;
  };
  expect(state.records.r!.text).toBe("第一步");
  recovered.close();
  const original = new DatabaseSync(
    path.join(env.root, "anan-local-v1.sqlite"),
  );
  expect(original.prepare("SELECT json FROM root").get()!.json).toBe("broken");
  original.close();
});
it("interrupted startup recovery never switches to a partial library or deletes prior media", async () => {
  const { store, backup, files } = await setup();
  const file = await backup.createBackup(store.get());
  const count = fs.readdirSync(files.mediaDirectory.uri).length;
  env.database!.close();
  env.database = null;
  env.rejectActivation = true;
  await expect(backup.recoverStartupBackup(file)).rejects.toThrow(
    "activation write failed",
  );
  const { activeLibraryName } = await import("../src/local/activation");
  expect(await activeLibraryName()).toBe("anan-local-v1.sqlite");
  expect(fs.readdirSync(files.mediaDirectory.uri)).toHaveLength(count);
});
it("persists a thumbnail with aspect-bearing dimensions at preserve time", async () => {
  const { files } = await setup();
  const original = path.join(env.root, "source.jpg");
  fs.writeFileSync(original, Buffer.alloc(64, 21));
  const media = await files.preserveMedia(original, "照片.jpg", "image");
  expect(media.thumb).toMatch(/^[a-f0-9-]+_t\.jpg$/);
  expect(media.width).toBe(512);
  expect(media.height).toBe(384);
  const thumbPath = path.join(files.mediaDirectory.uri, media.thumb!);
  expect(fs.readFileSync(thumbPath).toString()).toBe("thumb-bytes");
  files.deleteMediaFiles(media);
  expect(fs.existsSync(thumbPath)).toBe(false);
  expect(fs.existsSync(files.mediaFile(media).uri)).toBe(false);
});
it("names retention copies readably and prunes beyond the newest three", async () => {
  const { store, backup, files, media } = await setup();
  expect((await backup.createBackup(store.get())).name).toMatch(
    /^anan-\d{8}-\d{4}-[a-f0-9]{8}\.xmbm$/,
  );
  expect(fs.readdirSync(files.backupDirectory.uri)).toHaveLength(1);
  for (let i = 0; i < 3; i++) await backup.createBackup(store.get());
  const kept = fs.readdirSync(files.backupDirectory.uri);
  expect(kept).toHaveLength(3);
  expect(kept.every((name) => name.endsWith(".xmbm"))).toBe(true);
  // 四次备份，照片字节只落了一份，按内容哈希命名。
  expect(
    fs.readdirSync(
      path.join(files.blobDirectory.uri, media.sha256.slice(0, 2)),
    ),
  ).toEqual([media.sha256]);
});
it("同步清单独立保存且重复写入不挤掉三份保留备份", async () => {
  const { store, backup, files } = await setup();
  for (let i = 0; i < 3; i++) await backup.createBackup(store.get());
  const retained = backup.listLocalBackups().map((b) => b.file.uri);
  const before = retained.map((uri) => fs.readFileSync(uri));
  const first = await backup.createSyncManifest(store.get());
  expect(first.uri).toBe(files.syncManifestFile().uri);
  expect(backup.listLocalBackups().map((b) => b.file.uri)).toEqual(retained);
  await store.change((s) => { s.records.r = { ...s.records.r!, text: "同步后的内容" }; });
  // 上次中断的半成品也在同步目录里，重试会替换它。
  fs.writeFileSync(path.join(files.syncDirectory.uri, "manifest.xmbm.part"), "half");
  const second = await backup.createSyncManifest(store.get());
  expect(second.uri).toBe(first.uri);
  expect((await backup.inspectBackup(second)).records.r!.text).toBe("同步后的内容");
  expect(fs.readdirSync(files.syncDirectory.uri)).toEqual(["manifest.xmbm"]);
  expect(backup.listLocalBackups().map((b) => b.file.uri)).toEqual(retained);
  expect(retained.map((uri) => fs.readFileSync(uri))).toEqual(before);
});
it.each(["clear", "corrupt"])("同步清单独占的 blob 受保护，%s 后可回收", async (action) => {
  const { store, backup, files, media } = await setup();
  const manifest = await backup.createSyncManifest(store.get());
  expect(backup.listLocalBackups()).toEqual([]);
  expect(backup.collectBlobs()).toEqual({ removed: 0, bytes: 0 });
  expect(files.blobFile(media.sha256).exists).toBe(true);
  if (action === "clear") {
    const { clearSyncFiles } = await import("../src/sync/state");
    clearSyncFiles();
    expect(manifest.exists).toBe(false);
  } else manifest.write("bad bytes");
  expect(backup.collectBlobs()).toEqual({ removed: 1, bytes: media.bytes });
  expect(manifest.exists).toBe(false);
  expect(files.blobFile(media.sha256).exists).toBe(false);
  expect(files.mediaFile(media).exists).toBe(true);
});
it("同步清单写入失败保留上一份有效清单，不回收它引用的 blob", async () => {
  const { store, backup, files, media } = await setup();
  const manifest = await backup.createSyncManifest(store.get());
  const before = fs.readFileSync(manifest.uri);
  const { File } = await import("expo-file-system");
  vi.spyOn(File.prototype, "move").mockRejectedValueOnce(new Error("写不进去"));
  await expect(backup.createSyncManifest(store.get())).rejects.toThrow("写不进去");
  expect(fs.readFileSync(manifest.uri)).toEqual(before);
  expect(fs.readdirSync(files.syncDirectory.uri)).toEqual(["manifest.xmbm"]);
  expect(backup.collectBlobs()).toEqual({ removed: 0, bytes: 0 });
  expect(files.blobFile(media.sha256).exists).toBe(true);
});
it("stores each photo once by content hash and skips it on the next backup", async () => {
  const { store, backup, files, media } = await setup();
  const first = await backup.createBackup(store.get());
  const stored = files.blobFile(media.sha256);
  const blob = { sha256: media.sha256, bytes: media.bytes };
  expect(fs.readFileSync(stored.uri)).toEqual(Buffer.alloc(600000, 17));
  expect(first.size).toBeLessThan(600000);
  expect(await backup.ensureBlob(media, blob)).toBe(false);
  // 长度不对的旧 blob 会被重写，写完不留 .part。
  fs.writeFileSync(stored.uri, "short");
  expect(await backup.ensureBlob(media, blob)).toBe(true);
  expect(fs.readFileSync(stored.uri)).toEqual(Buffer.alloc(600000, 17));
  expect(fs.readdirSync(path.dirname(stored.uri))).toEqual([media.sha256]);
  // 原件被改过：哈希对不上就不入库，也不留半成品。
  fs.unlinkSync(stored.uri);
  fs.writeFileSync(files.mediaFile(media).uri, Buffer.alloc(600000, 18));
  await expect(backup.createBackup(store.get())).rejects.toThrow(
    "素材缺失或损坏",
  );
  expect(fs.readdirSync(path.dirname(stored.uri))).toEqual([]);
});
it("writes and verifies a manifest part before publishing its final name", async () => {
  const { store, backup, files } = await setup();
  const { File, FileMode } = await import("expo-file-system");
  const open = File.prototype.open;
  const operations: { name: string; mode?: string }[] = [];
  const spy = vi.spyOn(File.prototype, "open").mockImplementation(function (this: InstanceType<typeof File>, mode) {
    if (this.uri.startsWith(files.backupDirectory.uri + "/") && (mode === FileMode.WriteOnly || this.name.endsWith(".part"))) {
      operations.push({ name: this.name, mode });
      // 写入与读回校验期间，正式备份列表里都不应出现这份半成品。
      expect(backup.listLocalBackups()).toEqual([]);
    }
    return open.call(this, mode);
  });
  const out = await backup.createBackup(store.get());
  spy.mockRestore();
  expect(operations).toContainEqual({ name: out.name + ".part", mode: FileMode.WriteOnly });
  expect(operations).toContainEqual({ name: out.name + ".part", mode: FileMode.ReadOnly });
  expect((await backup.inspectBackup(out)).records).toEqual(store.get().records);
  expect(fs.readdirSync(files.backupDirectory.uri)).toEqual([out.name]);
});
it("ignores an interrupted manifest part when listing, pruning, collecting blobs and exporting", async () => {
  const { store, backup, files, media } = await setup();
  const out = await backup.createBackup(store.get());
  const partial = path.join(files.backupDirectory.uri, "anan-20260101-0900-deadbeef.xmbm.part");
  fs.writeFileSync(partial, fs.readFileSync(out.uri).subarray(0, 15));
  const stray = files.blobFile("ff".repeat(32));
  fs.mkdirSync(path.dirname(stray.uri), { recursive: true });
  fs.writeFileSync(stray.uri, "orphan");
  expect(backup.collectBlobs()).toEqual({ removed: 1, bytes: 6 });
  expect(files.blobFile(media.sha256).exists).toBe(true);
  expect(backup.listLocalBackups().map((entry) => entry.file.name)).toEqual([out.name]);
  expect(backup.restorePins()).toEqual([]);
  backup.pruneBackups(1);
  expect(backup.retainedBackups().map((file) => file.name)).toEqual([out.name]);
  const exporter = await import("../src/local/backup-export");
  const volume = await exporter.writeVolume(exporter.planExport(out), 0);
  expect((await backup.inspectBackup(volume)).records).toEqual(store.get().records);
});
it("collects only blobs no retained manifest references and stands down when one is unreadable", async () => {
  const { store, backup, files, media } = await setup();
  const out = await backup.createBackup(store.get());
  const stray = path.join(files.blobDirectory.uri, "ff", "ff".repeat(32));
  fs.mkdirSync(path.dirname(stray), { recursive: true });
  fs.writeFileSync(stray, "orphan");
  fs.writeFileSync(`${stray}.part`, "half");
  expect(backup.collectBlobs()).toEqual({ removed: 2, bytes: 10 });
  expect(fs.existsSync(files.blobFile(media.sha256).uri)).toBe(true);
  // 一份读不出的清单在场：宁可多占空间，也不动任何 blob。
  const broken = path.join(
    files.backupDirectory.uri,
    "anan-20260101-0900-deadbeef.xmbm",
  );
  fs.writeFileSync(broken, "XIAOMEI3broken");
  fs.writeFileSync(stray, "orphan");
  expect(backup.collectBlobs()).toBeNull();
  expect(fs.existsSync(stray)).toBe(true);
  fs.unlinkSync(broken);
  // 最后一份清单删掉后，它引用的照片字节也随之回收。
  out.delete();
  expect(backup.collectBlobs()).toEqual({ removed: 2, bytes: 600006 });
  expect(fs.existsSync(files.blobFile(media.sha256).uri)).toBe(false);
});
it("keeps blobs a remote-restore pin references and drops the pin after seven days", async () => {
  const { store, backup, files, media } = await setup();
  const out = await backup.createBackup(store.get());
  // 钉子 = 远端清单的原文，先落地再下载；保留备份删光了，它引用的照片也不能收。
  const pin = path.join(
    files.backupDirectory.uri,
    backup.restorePinName(new Date(), "abcd1234"),
  );
  fs.copyFileSync(out.uri, pin);
  out.delete();
  expect(backup.collectBlobs()).toEqual({ removed: 0, bytes: 0 });
  expect(fs.existsSync(files.blobFile(media.sha256).uri)).toBe(true);
  // 钉子不是保留备份：列表与启动救援都不认它。
  expect(backup.listLocalBackups()).toEqual([]);
  expect(backup.retainedBackups()).toEqual([]);
  // 读不出的钉子是废弃的半成品，回收时顺手清掉。
  fs.writeFileSync(pin, "XIAOMEI3broken");
  expect(backup.collectBlobs()).toEqual({ removed: 1, bytes: 600000 });
  expect(fs.existsSync(pin)).toBe(false);
  // 七天前的钉子由 pruneBackups 清掉，新的留着。
  const stale = path.join(
    files.backupDirectory.uri,
    backup.restorePinName(new Date(Date.now() - 8 * 86400000), "0ld00000"),
  );
  const fresh = path.join(
    files.backupDirectory.uri,
    backup.restorePinName(new Date(), "fresh000"),
  );
  fs.writeFileSync(stale, "x");
  fs.writeFileSync(fresh, "x");
  backup.pruneBackups(3);
  expect(fs.existsSync(stale)).toBe(false);
  expect(fs.existsSync(fresh)).toBe(true);
});
it("refuses to start a manifest backup when the blob store copy would not fit", async () => {
  const { store, backup, files } = await setup();
  env.free = 1000;
  await expect(backup.createBackup(store.get())).rejects.toThrow("空间不足");
  expect(backup.retainedBackups()).toEqual([]);
  expect(
    files.blobDirectory.exists ? fs.readdirSync(files.blobDirectory.uri) : [],
  ).toEqual([]);
  // 已经在库里的照片不占预算：之后的备份不再需要空间。
  env.free = Number.POSITIVE_INFINITY;
  await backup.createBackup(store.get());
  env.free = 1000;
  await backup.createBackup(store.get());
  expect(backup.retainedBackups()).toHaveLength(2);
});
it("lists retained backups with a readable label and the space they really stand for", async () => {
  const { store, backup } = await setup();
  const out = await backup.createBackup(store.get());
  const [entry] = backup.listLocalBackups();
  expect(entry!.file.name).toBe(out.name);
  expect(entry!.manifestOnly).toBe(true);
  expect(entry!.bytes).toBe(out.size + 600000);
  expect(entry!.label).toMatch(/^\d{1,2}月\d{1,2}日 \d{2}:\d{2}$/);
});
it("restoring the oldest retained backup does not prune it first", async () => {
  const { store, backup, model } = await setup();
  for (let i = 0; i < 3; i++) await backup.createBackup(store.get());
  const oldest = backup.retainedBackups().at(-1)!;
  await store.change((s) => {
    model.deleteRecord(s, "r");
  });
  const prior = await backup.restoreBackup(store, oldest);
  expect(store.get().records.r?.text).toBe("第一步");
  // 恢复完按常规只留三份：「恢复前」那份在，最旧的那份让位。
  const kept = backup.retainedBackups().map((f) => f.name);
  expect(kept).toHaveLength(3);
  expect(kept).toContain(prior.name);
  expect(kept).not.toContain(oldest.name);
});
it("exports one volume byte-identical to the Build 68 whole file and restores it without the blob store", async () => {
  const { store, backup, files, media } = await setup();
  const exporter = await import("../src/local/backup-export");
  const { encodeEntities, encodeMetaV2 } =
    await import("../src/local/backup-format");
  const manifest = await backup.createBackup(store.get());
  const plan = exporter.planExport(manifest);
  expect(plan.volumes).toHaveLength(1);
  const volume = await exporter.writeVolume(plan, 0);
  expect(volume.name).toBe(manifest.name.replace(/\.xmbm$/, ".xmb"));
  // Build 68 的写法：v2 魔数 + 同一份 meta + 实体 NDJSON + 素材字节，逐字节相同。
  const state = store.get();
  const entities = encodeEntities(state);
  const count = ENTITY_KINDS.reduce(
    (n, kind) => n + Object.keys(state[kind]).length,
    0,
  );
  const expected = Buffer.concat([
    encodeMetaV2(state, entities.length, count, {
      createdAt: plan.meta.createdAt,
    }),
    entities,
    Buffer.alloc(600000, 17),
  ]);
  expect(fs.readFileSync(volume.uri).equals(expected)).toBe(true);
  fs.rmSync(files.blobDirectory.uri, { recursive: true });
  const restored = await backup.inspectBackup(volume, true);
  expect(restored.records.r!.text).toBe("第一步");
  expect(
    fs.readFileSync(
      path.join(files.mediaDirectory.uri, restored.media[media.id]!.file),
    ),
  ).toEqual(Buffer.alloc(600000, 17));
  exporter.purgeExports();
  expect(fs.existsSync(exporter.exportDirectory.uri)).toBe(false);
});
it("splits an export into volumes, restores them in any order and names what is missing", async () => {
  const { store, backup, files } = await setup();
  const exporter = await import("../src/local/backup-export");
  for (const [name, fill] of [
    ["b", 5],
    ["c", 6],
  ] as const) {
    const source = path.join(env.root, `${name}.jpg`);
    fs.writeFileSync(source, Buffer.alloc(200000, fill));
    const m = await files.preserveMedia(source, `${name}.jpg`, "image");
    await store.change((s) => {
      s.media[m.id] = m;
    });
  }
  const manifest = await backup.createBackup(store.get());
  // 上限压到 300 KB：三张照片各自独占一卷。
  const plan = exporter.planExport(manifest, 300000);
  expect(plan.volumes.map((v) => v.take)).toEqual([1, 1, 1]);
  const volumes = [];
  for (let i = 0; i < 3; i++) volumes.push(await exporter.writeVolume(plan, i));
  expect(volumes.map((v) => v.name)).toEqual(
    [1, 2, 3].map((i) => `${plan.stem}-vol${i}of3.xmb`),
  );
  fs.rmSync(files.blobDirectory.uri, { recursive: true });
  const restored = await backup.inspectBackup(
    [volumes[2]!, volumes[0]!, volumes[1]!],
    true,
  );
  expect(Object.keys(restored.media)).toHaveLength(3);
  for (const m of Object.values(restored.media))
    expect(fs.statSync(path.join(files.mediaDirectory.uri, m.file)).size).toBe(
      m.bytes,
    );
  await expect(
    backup.inspectBackup([volumes[0]!, volumes[2]!]),
  ).rejects.toThrow("还缺第 2 卷（共 3 卷）");
  await expect(backup.inspectBackup(volumes[1]!)).rejects.toThrow(
    "这份备份有 3 卷",
  );
  await expect(
    backup.inspectBackup([volumes[0]!, volumes[0]!]),
  ).rejects.toThrow("同一卷选了两次");
  await expect(backup.inspectBackup([volumes[0]!, manifest])).rejects.toThrow(
    "只能是同一份备份的分卷",
  );
  // 另一份备份的卷混进来：set 不同，一眼认出。
  const other = exporter.planExport(
    await backup.createBackup(store.get()),
    300000,
  );
  const stranger = await exporter.writeVolume(other, 1);
  await expect(
    backup.inspectBackup([volumes[0]!, stranger, volumes[2]!]),
  ).rejects.toThrow("不是同一份备份");
  // 空间不够写这一卷：先说清楚，一个字节都不写。
  exporter.purgeExports();
  env.free = 1000;
  await expect(exporter.writeVolume(plan, 0)).rejects.toThrow("空间不足");
  expect(fs.existsSync(exporter.exportDirectory.uri)).toBe(false);
});
it("keeps the newest retention copy when older ones still carry the former prefix", async () => {
  const { backup, files } = await setup();
  files.ensureDirectories();
  for (const name of [
    "xiaomei-20250101-0900-aaaaaaaa.xmb",
    "xiaomei-20250102-0900-bbbbbbbb.xmb",
    "xiaomei-20250103-0900-cccccccc.xmb",
  ])
    fs.writeFileSync(path.join(files.backupDirectory.uri, name), "old");
  const fresh = "anan-20260918-0900-dddddddd.xmb";
  fs.writeFileSync(path.join(files.backupDirectory.uri, fresh), "new");
  backup.pruneBackups(3);
  const kept = fs.readdirSync(files.backupDirectory.uri);
  // 按整个文件名排序的话 anan-* 排在所有 xiaomei-* 前面，最新的这份会第一个被删。
  expect(kept).toContain(fresh);
  expect(kept).toHaveLength(3);
  expect(kept).not.toContain("xiaomei-20250101-0900-aaaaaaaa.xmb");
});
it("counts calendar days since the last export and flags never-exported libraries", async () => {
  const { backup } = await setup();
  expect(backup.daysSinceExport({})).toBeNull();
  expect(backup.daysSinceExport({ lastExportAt: "not-a-date" })).toBeNull();
  expect(
    backup.daysSinceExport(
      { lastExportAt: "2026-08-15T10:00:00" },
      new Date(2026, 8, 17),
    ),
  ).toBe(33);
  expect(
    backup.daysSinceExport(
      { lastExportAt: "2026-08-15T10:00:00" },
      new Date(2026, 7, 15),
    ),
  ).toBe(0);
});
it("writes one copy of a photo that appears twice and restores both", async () => {
  const { store, backup, files } = await setup();
  const twin = path.join(env.root, "twin.jpg");
  fs.writeFileSync(twin, Buffer.alloc(300000, 7));
  const a = await files.preserveMedia(twin, "双胞胎-1.jpg", "image");
  const b = await files.preserveMedia(twin, "双胞胎-2.jpg", "image");
  await store.change((s) => {
    s.media[a.id] = a;
    s.media[b.id] = b;
  });
  const out = await backup.createBackup(store.get());
  // setup 的 600000 字节 + 双胞胎的一份 300000，而不是两份。
  expect(out.size).toBeLessThan(600000 + 300000 * 2);
  const restored = await backup.inspectBackup(out, true);
  const fileA = restored.media[a.id]!.file;
  const fileB = restored.media[b.id]!.file;
  // 两条素材各有自己的文件：删掉一条不会把另一条的原件一起带走。
  expect(fileA).not.toBe(fileB);
  const read = (name: string) =>
    fs.readFileSync(path.join(files.mediaDirectory.uri, name));
  expect(read(fileA).equals(read(fileB))).toBe(true);
  expect(read(fileA)).toHaveLength(300000);
});
it("still restores a Build 62 backup written in the old single-manifest format", async () => {
  const { store, backup, files } = await setup();
  const { File } = await import("expo-file-system");
  const { encodeHeader } = await import("../src/local/backup-format");
  const state = store.get();
  const parts = [Buffer.from(encodeHeader(state))];
  for (const id of Object.keys(state.media).sort())
    parts.push(fs.readFileSync(files.mediaFile(state.media[id]!).uri));
  const legacy = path.join(env.root, "legacy.xmb");
  fs.writeFileSync(legacy, Buffer.concat(parts));
  const restored = await backup.inspectBackup(new File(legacy), true);
  expect(restored.records.r!.text).toBe("第一步");
  expect(Object.keys(restored.media)).toHaveLength(
    Object.keys(state.media).length,
  );
});
it("carries sealed letters and their recordings through a backup", async () => {
  const { store, backup, files } = await setup();
  const original = path.join(env.root, "voice.m4a");
  fs.writeFileSync(original, Buffer.alloc(4096, 9));
  const voice = await files.preserveMedia(original, "录音.m4a", "audio");
  await store.change((s) => {
    s.media[voice.id] = voice;
    s.letters.l1 = {
      id: "l1",
      title: "写给十八岁的你",
      text: "今天你第一次叫了妈妈。",
      from: "妈妈",
      openAt: "2042-06-15",
      writtenAt: new Date().toISOString(),
      sealed: true,
      mediaIds: [voice.id],
      coverId: null,
      updatedAt: new Date().toISOString(),
    };
  });
  const out = await backup.createBackup(store.get());
  const restored = await backup.inspectBackup(out);
  expect(restored.letters.l1!.text).toBe("今天你第一次叫了妈妈。");
  expect(restored.letters.l1!.mediaIds).toEqual([voice.id]);
  expect(restored.media[voice.id]!.sha256).toBe(voice.sha256);
});
it("carries a library whose text would have blown the old 16MB manifest", async () => {
  const { store, backup } = await setup();
  const { encodeHeader } = await import("../src/local/backup-format");
  await store.change((s) => {
    s.records.big = {
      ...s.records.r!,
      id: "big",
      text: "长".repeat(6_000_000),
    };
  });
  // 旧格式把整库塞进一条清单里，这一下就撞墙了。
  expect(() => encodeHeader(store.get())).toThrow("备份清单过大");
  const out = await backup.createBackup(store.get());
  const restored = await backup.inspectBackup(out);
  expect(restored.records.big!.text).toHaveLength(6_000_000);
});
it("restores with progress and lets other writes through while it unpacks", async () => {
  const { store, backup } = await setup();
  const out = await backup.createBackup(store.get());
  const stages: string[] = [];
  const order: string[] = [];
  let queued: Promise<unknown> | null = null;
  await backup.restoreBackup(store, out, (stage) => {
    stages.push(stage);
    // 解包阶段扣着写队列的话，这次写入只能排在恢复之后。
    if (stage.includes("解包") && !queued)
      queued = store.change(() => {
        order.push("并发写入");
      });
  });
  order.push("恢复完成");
  await queued;
  expect(order).toEqual(["并发写入", "恢复完成"]);
  expect(stages[0]).toContain("备份当前内容");
  expect(stages.some((s) => s.includes("缩略图"))).toBe(true);
  expect(stages[stages.length - 1]).toContain("写入本机资料");
  expect(store.get().records.r?.text).toBe("第一步");
});
it("labels a retained backup by its local day and minute, never by file name", async () => {
  const backup = await import("../src/local/backup");
  const at = new Date(2026, 8, 19, 15, 44);
  expect(backup.backupStampLabel(backup.backupFileName(at, "abc"), at)).toBe(
    "9月19日 15:44",
  );
  expect(backup.backupStampLabel("anan-20250102-0905-x.xmb", at)).toBe(
    "2025年1月2日 09:05",
  );
  expect(backup.backupStampLabel("renamed.xmb", at)).toBeNull();
});
it("backs up and restores a brand-new library with nothing in it yet", async () => {
  const { openLocalStore } = await import("../src/local/disk");
  const backup = await import("../src/local/backup");
  const store = await openLocalStore();
  const out = await backup.createBackup(store.get());
  const restored = await backup.inspectBackup(out, true);
  expect(Object.keys(restored.records)).toEqual([]);
  expect(Object.keys(restored.media)).toEqual([]);
  expect(restored.welcome).toBe(false);
});
it("keeps the old single-row library when the cutover cannot finish", async () => {
  const { store } = await setup();
  const before = store.get();
  env.database!.exec("DELETE FROM entity; DELETE FROM root;");
  env
    .database!.prepare("INSERT INTO library(id,snapshot) VALUES(1,?)")
    .run(JSON.stringify(before));
  // 切代的最后一步失败：整笔必须回滚，旧快照原样留着。
  env.database!.exec(
    "CREATE TRIGGER reject_cutover BEFORE DELETE ON library BEGIN SELECT RAISE(ABORT, 'cutover failed'); END;",
  );
  env.database!.close();
  env.database = null;
  vi.resetModules();
  const { openLocalStore } = await import("../src/local/disk");
  await expect(openLocalStore()).rejects.toThrow();
  const db = new DatabaseSync(path.join(env.root, "anan-local-v1.sqlite"));
  expect(db.prepare("SELECT COUNT(*) n FROM library").get()).toEqual({ n: 1 });
  expect(db.prepare("SELECT COUNT(*) n FROM root").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT COUNT(*) n FROM entity").get()).toEqual({ n: 0 });
  expect(
    JSON.parse(
      (db.prepare("SELECT snapshot FROM library").get() as { snapshot: string })
        .snapshot,
    ).records.r.text,
  ).toBe("第一步");
  db.close();
});

/** 两条记录（r1 带一张照片）和一本已含 r1 的相册，给落款与墓碑的服务测试用。 */
function signatureFixture(): Library {
  const lib = emptyLibrary();
  const date = "2026-09-16T12:00:00.000Z";
  lib.media.photo = { id: "photo", file: "photo.jpg", name: "baby.jpg", kind: "image", bytes: 8, sha256: "a".repeat(64) };
  for (const id of ["r1", "r2"])
    lib.records[id] = { id, title: "", text: `记下 ${id}`, date, location: "", first: false, mediaIds: id === "r1" ? ["photo"] : [], coverId: id === "r1" ? "photo" : null, revision: 1, updatedAt: date };
  lib.albums.a = { id: "a", name: "a", items: [{ id: "i", recordId: "r1" }], coverId: null, updatedAt: date };
  return lib;
}

it("stamps settings.by onto a fresh draft but leaves edits of old records alone", async () => {
    const { beginDraft } = await import("../src/local/services");
    let disk: Library = signatureFixture();
    disk.settings.by = "外婆";
    const store = new LocalStore({
      read: async () => disk,
      write: async (next) => {
        disk = clone(next);
      },
    });
    await store.open();
    const fresh = await beginDraft(store);
    expect(store.get().drafts[fresh]!.content.by).toBe("外婆");
    const edit = await beginDraft(store, "r1");
    expect(store.get().drafts[edit]!.content.by).toBeUndefined();
    await store.change((s) => {
      delete s.settings.by;
    });
    const unsigned = await beginDraft(store);
    expect(store.get().drafts[unsigned]!.content.by).toBeUndefined();
  });
it("deleting albums and letters through services and legacy series through the model leaves tombstones", async () => {
    const { deleteAlbum, deleteLetter } = await import("../src/local/services");
    let disk: Library = signatureFixture();
    const date = "2026-09-16T12:00:00.000Z";
    disk.series.t = { id: "t", name: "t", items: [], updatedAt: date };
    disk.letters.l = { id: "l", title: "", text: "", from: "", openAt: "2042-06-15", writtenAt: date, sealed: false, mediaIds: [], coverId: null, updatedAt: date };
    const store = new LocalStore({
      read: async () => disk,
      write: async (next) => {
        disk = clone(next);
      },
    });
    await store.open();
    await deleteAlbum(store, "a");
    await store.change((s) => deleteSeries(s, "t", date));
    await deleteLetter(store, "l");
    expect(Object.keys(store.get().tombstones!).sort()).toEqual(["albums:a", "letters:l", "series:t"]);
    expect(Object.keys(disk.albums)).toEqual([]);
    for (const at of Object.values(disk.tombstones!)) expect(Number.isFinite(Date.parse(at))).toBe(true);
  });

it("A-14 清掉一小时前的清单写入残片，保留新残片与七天内恢复钉子", async () => {
  const { backup, files } = await setup();
  fs.mkdirSync(files.backupDirectory.uri, { recursive: true });
  const old = new Date(Date.now() - 2 * 3600000);
  const stale = path.join(files.backupDirectory.uri, backup.backupFileName(old, "stale", "xmbm.part"));
  const fresh = path.join(files.backupDirectory.uri, backup.backupFileName(new Date(), "fresh", "xmbm.part"));
  const pin = path.join(files.backupDirectory.uri, backup.restorePinName(old, "pin"));
  for (const file of [stale, fresh, pin]) fs.writeFileSync(file, "unfinished");
  backup.pruneBackups();
  expect(fs.existsSync(stale)).toBe(false);
  expect(fs.existsSync(fresh)).toBe(true);
  expect(fs.existsSync(pin)).toBe(true);
});

it("records letter ancestry through rewriting, sealing and opening, with no ancestry on creation", async () => {
  const { beginLetter, updateLetter, sealLetter, openLetter } = await import("../src/local/services");
  const { LocalStore } = await import("../src/local/store");
  let disk = emptyLibrary();
  const store = new LocalStore({ read: async () => disk, write: async (s) => { disk = clone(s); } });
  await store.open();
  const id = await beginLetter(store, "爸爸");
  const created = store.get().letters[id]!;
  expect(created).not.toHaveProperty("ancestors");
  await store.change((s) => updateLetter(s, { ...created, text: "给未来的你", ancestors: ["f".repeat(16)] }));
  const written = store.get().letters[id]!;
  expect(written.ancestors).toEqual([contentHashOf(created).slice(0, 16)]);
  await sealLetter(store, id);
  const sealed = store.get().letters[id]!;
  expect(sealed.ancestors).toEqual([contentHashOf(written).slice(0, 16), ...written.ancestors!]);
  await openLetter(store, id);
  const opened = store.get().letters[id]!;
  expect(opened.ancestors).toEqual([contentHashOf(sealed).slice(0, 16), ...sealed.ancestors!]);
  await openLetter(store, id);
  expect(store.get().letters[id]).toEqual(opened);
  expect(created).not.toHaveProperty("ancestors");
  expect(disk.letters[id]).toEqual(opened);
});

it.each(["xmbm", "xmb"])("preserves record and letter ancestry through %s restore", async (format) => {
  const { store, backup, model } = await setup();
  const ancestors = ["abcdef0123456789", "0123456789abcdef"];
  await store.change((s) => {
    s.records.r = { ...s.records.r!, ancestors };
    s.letters.l = {
      id: "l", title: "给你", text: "慢慢长大", from: "爸爸", openAt: "2044-06-15",
      writtenAt: "2026-09-20T00:00:00Z", sealed: false, mediaIds: [], coverId: null,
      updatedAt: "2026-09-20T00:00:00Z", ancestors,
    };
  });
  const saved = model.clone(store.get());
  const manifest = await backup.createBackup(saved);
  const exporter = await import("../src/local/backup-export");
  const file = format === "xmbm" ? manifest : await exporter.writeVolume(exporter.planExport(manifest), 0);
  await store.change((s) => {
    model.deleteRecord(s, "r");
    model.deleteLetter(s, "l");
  });
  await backup.restoreBackup(store, file);
  expect(store.get().records.r).toEqual(saved.records.r);
  expect(store.get().letters.l).toEqual(saved.letters.l);
});
