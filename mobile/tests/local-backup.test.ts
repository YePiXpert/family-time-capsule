import { beforeEach, afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DatabaseSync } from "node:sqlite";
import type { NativeShareManifest } from "../modules/share-intake/src";
import { ENTITY_KINDS } from "../src/local/model";
const env = vi.hoisted(() => ({
  root: "",
  shares: [] as NativeShareManifest[],
  acknowledged: [] as string[],
  rejectActivation: false,
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
vi.mock("expo-image-manipulator", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  return {
    SaveFormat: { JPEG: "jpeg" },
    manipulateAsync: async () => {
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
      const p = path.join(env.root, "cache-vthumb.jpg");
      fs.writeFileSync(p, "vthumb-bytes");
      return { uri: p, width: 640, height: 480 };
    },
  };
});
vi.mock("expo-file-system", () => {
  // Expo 的 uri 始终是 POSIX 写法；Windows 上 path.join 会产生反斜杠，
  // 让按 "/" 校验的正式代码误判，因此这里统一成 POSIX 分隔符。
  function target(parts: (string | { uri: string })[]) {
    return parts
      .map((x) => (typeof x === "string" ? x : x.uri))
      .join("/")
      .replace(/\\/g, "/");
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = target(parts);
    }
    get exists() {
      return fs.existsSync(this.uri);
    }
    create() {
      fs.mkdirSync(this.uri, { recursive: true });
    }
    list() {
      return fs.readdirSync(this.uri).map((n) => new File(this, n));
    }
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = target(parts);
    }
    get name() {
      return path.basename(this.uri);
    }
    get exists() {
      return fs.existsSync(this.uri);
    }
    get size() {
      return fs.statSync(this.uri).size;
    }
    create() {
      fs.writeFileSync(this.uri, "", { flag: "wx" });
    }
    write(value: string) {
      fs.writeFileSync(this.uri, value);
    }
    async text() {
      return fs.readFileSync(this.uri, "utf8");
    }
    delete() {
      fs.unlinkSync(this.uri);
    }
    async copy(to: File) {
      fs.copyFileSync(this.uri, to.uri, fs.constants.COPYFILE_EXCL);
    }
    async move(to: File) {
      if (
        env.rejectActivation &&
        to.uri.includes("libraries/") &&
        to.uri.endsWith(".json")
      )
        throw new Error("activation write failed");
      fs.renameSync(this.uri, to.uri);
      this.uri = to.uri;
    }
    open(mode: string) {
      const fd = fs.openSync(this.uri, mode === "r" ? "r" : "r+");
      let offset = 0;
      return {
        close: () => fs.closeSync(fd),
        readBytes(n: number) {
          const b = Buffer.alloc(n);
          const count = fs.readSync(fd, b, 0, n, offset);
          offset += count;
          return new Uint8Array(b.subarray(0, count));
        },
        writeBytes(b: Uint8Array) {
          fs.writeSync(fd, b, 0, b.length, offset);
          offset += b.length;
        },
      };
    }
  }
  return {
    Directory,
    File,
    FileMode: { ReadOnly: "r", WriteOnly: "w" },
    Paths: {
      get document() {
        return new Directory(env.root);
      },
    },
  };
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
  env.rejectActivation = false;
  env.shares = [];
  env.acknowledged = [];
  env.root = fs.mkdtempSync(path.join(os.tmpdir(), "xiaomei-test-"));
});
afterEach(() => {
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
    | { json: string }
    | undefined;
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
  env.database!
    .prepare("INSERT INTO library(id,snapshot) VALUES(1,?)")
    .run(JSON.stringify(before));
  env.database!.close();
  env.database = null;
  vi.resetModules();
  const { openLocalStore } = await import("../src/local/disk");
  const reopened = await openLocalStore();
  expect(reopened.get()).toEqual(before);
  // 切代完成后旧单行退场，之后只读实体表。
  expect(
    env.database!.prepare("SELECT COUNT(*) n FROM library").get(),
  ).toEqual({ n: 0 });
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
it("rejects corrupted and truncated backups before changing current data", async () => {
  const { store, backup } = await setup();
  const out = await backup.createBackup(store.get());
  const bytes = fs.readFileSync(out.uri);
  bytes[bytes.length - 1] = 3;
  fs.writeFileSync(out.uri, bytes);
  const revision = store.get().revision;
  await expect(backup.restoreBackup(store, out)).rejects.toThrow("校验失败");
  expect(store.get().revision).toBe(revision);
  fs.writeFileSync(out.uri, bytes.subarray(0, bytes.length - 2));
  await expect(backup.inspectBackup(out)).rejects.toThrow("长度");
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
it("receives a native shared original once and acknowledges only its committed draft", async () => {
  const { store, files } = await setup();
  const { receiveShares } = await import("../src/local/services");
  const original = `${env.root.replace(/\\/g, "/")}/xiaomei-v1/intake/originals/shared.jpg`;
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
  const original = `${env.root.replace(/\\/g, "/")}/xiaomei-v1/intake/originals/shared.jpg`;
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
  await expect(receiveShares(store)).rejects.toThrow(
    "有 2 份分享素材未能保存",
  );
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
  await expect(receiveShares(store)).rejects.toThrow(
    "有 1 份分享素材未能保存",
  );
  expect(Object.values(store.get().drafts)).toEqual([]);
  expect(env.acknowledged).toEqual(["broken"]);
});
it("removes copied files when the library write fails mid-batch", async () => {
  const { store, files } = await setup();
  const { receiveShares } = await import("../src/local/services");
  const original = `${env.root.replace(/\\/g, "/")}/xiaomei-v1/intake/originals/shared.jpg`;
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
  const originals = `${env.root.replace(/\\/g, "/")}/xiaomei-v1/intake/originals`;
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
  expect(draft.groupPhotosByDay).toBe(true);
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
  expect(name).toMatch(/^xiaomei-recovered-/);
  const recovered = new DatabaseSync(path.join(env.root, name));
  const state = readLibrary(recovered) as { records: Record<string, { text: string }> };
  expect(state.records.r!.text).toBe("第一步");
  recovered.close();
  const original = new DatabaseSync(
    path.join(env.root, "xiaomei-local-v1.sqlite"),
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
  expect(await activeLibraryName()).toBe("xiaomei-local-v1.sqlite");
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
  const { store, backup, files } = await setup();
  expect((await backup.createBackup(store.get())).name).toMatch(
    /^xiaomei-\d{8}-\d{4}-[a-f0-9]{8}\.xmb$/,
  );
  expect(fs.readdirSync(files.backupDirectory.uri)).toHaveLength(1);
  for (let i = 0; i < 3; i++) await backup.createBackup(store.get());
  const kept = fs.readdirSync(files.backupDirectory.uri);
  expect(kept).toHaveLength(3);
  expect(kept.every((name) => name.endsWith(".xmb"))).toBe(true);
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
