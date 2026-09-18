import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const env = vi.hoisted(() => ({ root: "", failRename: "" }));

vi.mock("expo-file-system", () => {
  const join = (parts: (string | { uri: string })[]) =>
    parts
      .map((x) => (typeof x === "string" ? x : x.uri))
      .join("/")
      .replace(/\\/g, "/");
  function rename(item: { uri: string }, name: string) {
    if (name === env.failRename) throw new Error("磁盘忙");
    const to = join([path.dirname(item.uri), name]);
    fs.renameSync(item.uri, to);
    item.uri = to;
  }
  // expo 的语义：move 到已存在的目录是「搬进去」，到不存在的路径才是「改名」。
  function move(item: { uri: string }, to: { uri: string }) {
    const into = fs.existsSync(to.uri) && fs.statSync(to.uri).isDirectory();
    const target = into ? join([to.uri, path.basename(item.uri)]) : to.uri;
    fs.renameSync(item.uri, target);
    item.uri = target;
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
    }
    get name() {
      return path.basename(this.uri);
    }
    get exists() {
      return fs.existsSync(this.uri);
    }
    create() {
      fs.mkdirSync(this.uri, { recursive: true });
    }
    list() {
      return fs.readdirSync(this.uri).map((n) => {
        const child = join([this.uri, n]);
        return fs.statSync(child).isDirectory()
          ? new Directory(child)
          : new File(child);
      });
    }
    delete() {
      fs.rmSync(this.uri, { recursive: true });
    }
    rename(name: string) {
      rename(this, name);
    }
    async move(to: { uri: string }) {
      move(this, to);
    }
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
    }
    get name() {
      return path.basename(this.uri);
    }
    get exists() {
      return fs.existsSync(this.uri);
    }
    rename(name: string) {
      rename(this, name);
    }
    async move(to: { uri: string }) {
      move(this, to);
    }
  }
  return {
    Directory,
    File,
    Paths: {
      get document() {
        return new Directory(env.root);
      },
    },
  };
});

const write = (relative: string, body: string) => {
  const full = path.join(env.root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
};
const read = (relative: string) =>
  fs.readFileSync(path.join(env.root, relative), "utf8");
const there = (relative: string) => fs.existsSync(path.join(env.root, relative));

async function migrate() {
  const { migrateLegacyNames } = await import("../src/local/rename");
  return migrateLegacyNames();
}

beforeEach(() => {
  vi.resetModules();
  env.failRename = "";
  env.root = fs.mkdtempSync(path.join(os.tmpdir(), "anan-rename-"));
});
afterEach(() => {
  fs.rmSync(env.root, { recursive: true, force: true });
});

it("carries the whole former library over to the new name", async () => {
  write("xiaomei-v1/media/photo.jpg", "照片字节");
  write("xiaomei-v1/health.json", "{}");
  write("xiaomei-v1/backups/xiaomei-20250103-0900-cccccccc.xmb", "旧备份");
  write("SQLite/xiaomei-local-v1.sqlite", "库");
  write("SQLite/xiaomei-local-v1.sqlite-wal", "预写日志");
  write("SQLite/xiaomei-local-v1.sqlite-shm", "共享内存");

  expect(await migrate()).toEqual([]);

  expect(read("anan-v1/media/photo.jpg")).toBe("照片字节");
  expect(read("anan-v1/health.json")).toBe("{}");
  expect(read("SQLite/anan-local-v1.sqlite")).toBe("库");
  // WAL 里可能压着已提交的事务，三个文件必须一起改名。
  expect(read("SQLite/anan-local-v1.sqlite-wal")).toBe("预写日志");
  expect(read("SQLite/anan-local-v1.sqlite-shm")).toBe("共享内存");
  expect(read("anan-v1/backups/anan-20250103-0900-cccccccc.xmb")).toBe("旧备份");
  expect(there("xiaomei-v1")).toBe(false);
  expect(there("SQLite/xiaomei-local-v1.sqlite")).toBe(false);
});

it("never lets the former library overwrite one already at the new name", async () => {
  write("SQLite/xiaomei-local-v1.sqlite", "旧库");
  write("SQLite/anan-local-v1.sqlite", "新库");
  write("xiaomei-v1/media/old.jpg", "旧的");
  write("anan-v1/media/new.jpg", "新的");

  expect(await migrate()).toEqual([]);

  // 库文件只认新名字下那一份，旧的原地留着，不覆盖也不删。
  expect(read("SQLite/anan-local-v1.sqlite")).toBe("新库");
  expect(read("SQLite/xiaomei-local-v1.sqlite")).toBe("旧库");
  // 目录里不冲突的素材照常并过去，两边的都在。
  expect(read("anan-v1/media/new.jpg")).toBe("新的");
  expect(read("anan-v1/media/old.jpg")).toBe("旧的");
});

it("reports the step that failed and still finishes the others", async () => {
  write("xiaomei-v1/media/photo.jpg", "照片字节");
  write("SQLite/xiaomei-local-v1.sqlite", "库");
  env.failRename = "anan-v1";

  const failures = await migrate();

  expect(failures).toHaveLength(1);
  expect(failures[0]).toContain("文档目录改名失败");
  // 文档目录没搬动，资料原样在旧名字下，应用照常能用。
  expect(read("xiaomei-v1/media/photo.jpg")).toBe("照片字节");
  // 其余步骤不受影响。
  expect(read("SQLite/anan-local-v1.sqlite")).toBe("库");
});

it("is safe to run again on an already migrated device", async () => {
  write("xiaomei-v1/media/photo.jpg", "照片字节");
  write("SQLite/xiaomei-local-v1.sqlite", "库");
  await migrate();
  vi.resetModules();

  expect(await migrate()).toEqual([]);
  expect(read("anan-v1/media/photo.jpg")).toBe("照片字节");
  expect(read("SQLite/anan-local-v1.sqlite")).toBe("库");
});

it("leaves an unmigrated device alone when there is nothing to carry over", async () => {
  write("anan-v1/media/photo.jpg", "照片字节");

  expect(await migrate()).toEqual([]);

  expect(read("anan-v1/media/photo.jpg")).toBe("照片字节");
  expect(there("xiaomei-v1")).toBe(false);
});

it("merges into a new directory that something else created first", async () => {
  // 安卓收到分享意图时会先往新名字下写 intake，那一刻 JS 还没启动过。
  write("anan-v1/intake/originals/incoming.jpg", "刚分享进来的");
  write("xiaomei-v1/media/photo.jpg", "照片字节");
  write("xiaomei-v1/health.json", "{}");
  write("xiaomei-v1/intake/manifests/a.json", "旧清单");

  expect(await migrate()).toEqual([]);

  expect(read("anan-v1/media/photo.jpg")).toBe("照片字节");
  expect(read("anan-v1/health.json")).toBe("{}");
  expect(read("anan-v1/intake/manifests/a.json")).toBe("旧清单");
  expect(read("anan-v1/intake/originals/incoming.jpg")).toBe("刚分享进来的");
  expect(there("xiaomei-v1")).toBe(false);
});

it("keeps the newer copy on a name clash and leaves the leftovers findable", async () => {
  write("anan-v1/health.json", "新的");
  write("xiaomei-v1/health.json", "旧的");
  write("xiaomei-v1/media/photo.jpg", "照片字节");

  expect(await migrate()).toEqual([]);

  expect(read("anan-v1/health.json")).toBe("新的");
  expect(read("anan-v1/media/photo.jpg")).toBe("照片字节");
  // 搬不过去的那份留在原地，不静默删掉。
  expect(read("xiaomei-v1/health.json")).toBe("旧的");
});
