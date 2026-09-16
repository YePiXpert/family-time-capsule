import { beforeEach, afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DatabaseSync } from "node:sqlite";
const env = vi.hoisted(() => ({
  root: "",
  database: null as DatabaseSync | null,
}));
vi.mock("expo-crypto", async () => ({
  randomUUID: (await import("node:crypto")).randomUUID,
}));
vi.mock("expo-sharing", () => ({
  isAvailableAsync: async () => true,
  shareAsync: async () => {},
}));
vi.mock("expo-file-system", () => {
  function target(parts: (string | { uri: string })[]) {
    return path.join(...parts.map((x) => (typeof x === "string" ? x : x.uri)));
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
    delete() {
      fs.unlinkSync(this.uri);
    }
    async copy(to: File) {
      fs.copyFileSync(this.uri, to.uri, fs.constants.COPYFILE_EXCL);
    }
    async move(to: File) {
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
      runAsync: async (sql: string, ...args: (string | number)[]) =>
        db.prepare(sql).run(...args),
      closeAsync: async () => db.close(),
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
it("runs production SQLite writes and reopens its complete snapshot", async () => {
  const { store } = await setup();
  const row = env
    .database!.prepare("SELECT snapshot FROM library WHERE id=1")
    .get() as { snapshot: string };
  expect(JSON.parse(row.snapshot)).toEqual(store.get());
  expect(store.get().records.r?.text).toBe("第一步");
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
    "CREATE TRIGGER reject_update BEFORE UPDATE ON library BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
  );
  const before = JSON.stringify(store.get());
  await expect(backup.restoreBackup(store, out)).rejects.toThrow("disk full");
  expect(JSON.stringify(store.get())).toBe(before);
  expect(fs.readdirSync(files.mediaDirectory.uri)).toHaveLength(count);
});
