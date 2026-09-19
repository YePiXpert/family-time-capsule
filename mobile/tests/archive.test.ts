import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ArchiveStopped, createArchive, estimateArchiveBytes } from "../src/local/archive";
import { planArchive } from "../src/local/archive-layout";
import { emptyLibrary, type Library, type LocalMedia } from "../src/local/model";

// mediaDirectory 在 files.ts 加载时就按 Paths.document 定死，所以根目录要在 import 之前定下来；
// vi.hoisted 里拿不到 import 的模块，只能用全局的 process 拼路径，目录在 beforeEach 里建。
const env = vi.hoisted(() => ({
  root: `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/anan-archive-${process.pid}-${Date.now()}`.replace(
    /\\/g,
    "/",
  ),
  free: Number.POSITIVE_INFINITY,
}));
vi.mock("expo-sharing", () => ({
  isAvailableAsync: async () => true,
  shareAsync: async () => {},
}));
vi.mock("expo-crypto", async () => ({
  randomUUID: (await import("node:crypto")).randomUUID,
}));
vi.mock("expo-image-manipulator", () => ({ SaveFormat: { JPEG: "jpeg" } }));
vi.mock("expo-video-thumbnails", () => ({}));
vi.mock("expo-file-system", () => {
  const target = (parts: (string | { uri: string })[]) =>
    parts.map((x) => (typeof x === "string" ? x : x.uri)).join("/").replace(/\\/g, "/");
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
        return new Directory(env.root, "documents");
      },
      get cache() {
        return new Directory(env.root, "cache");
      },
      get availableDiskSpace() {
        return env.free;
      },
    },
  };
});


const NOW_YEAR = String(new Date().getFullYear());

function inspect(file: string) {
  const script = [
    "import json,sys,zipfile,hashlib",
    "z=zipfile.ZipFile(sys.argv[1])",
    "assert z.testzip() is None",
    "print(json.dumps({'names': z.namelist(), 'sha': {i.filename: hashlib.sha256(z.read(i)).hexdigest() for i in z.infolist()}}))",
  ].join("\n");
  for (const python of ["python3", "python"]) {
    const run = spawnSync(python, ["-c", script, file], { encoding: "utf8" });
    if (run.error) continue;
    if (run.status !== 0) throw new Error(run.stderr || run.stdout);
    return JSON.parse(run.stdout) as { names: string[]; sha: Record<string, string> };
  }
  throw new Error("python3 is required to verify ZIP output");
}
const sha256 = (b: Uint8Array) =>
  createHash("sha256").update(b).digest("hex");

function seed(): { state: Library; photo: Uint8Array } {
  const mediaDir = path.join(env.root, "documents", "anan-v1", "media");
  fs.mkdirSync(mediaDir, { recursive: true });
  const photo = new Uint8Array(300_000);
  for (let i = 0; i < photo.length; i++) photo[i] = (i * 31) & 0xff;
  fs.writeFileSync(path.join(mediaDir, "p.jpg"), photo);
  fs.writeFileSync(path.join(mediaDir, "a.m4a"), Buffer.alloc(1000, 7));
  const s = emptyLibrary();
  s.profile.name = "桉桉";
  const m = (id: string, ext: string, kind: LocalMedia["kind"], bytes: number): LocalMedia => ({
    id, file: `${id}.${ext}`, name: `${id}.${ext}`, kind, bytes, sha256: "a".repeat(64),
  });
  s.media.p = m("p", "jpg", "image", photo.length);
  s.media.a = m("a", "m4a", "audio", 1000);
  s.records.r = {
    id: "r", title: "第一次挥手", text: "正文", date: "2026-09-15T10:00:00.000", location: "",
    first: true, mediaIds: ["p", "a"], coverId: "p", revision: 1, updatedAt: "2026-09-15T10:00:00.000",
  };
  return { state: s, photo };
}

describe("createArchive", () => {
  beforeEach(() => {
    fs.rmSync(env.root, { recursive: true, force: true });
    fs.mkdirSync(env.root, { recursive: true });
    env.free = Number.POSITIVE_INFINITY;
  });
  it("streams a zip into the cache that python can open, reporting progress", async () => {
    const { state, photo } = seed();
    const progress: number[] = [];
    const { file, plan } = await createArchive(state, {}, (p) => progress.push(p.done));
    expect(file.uri.startsWith(`${env.root}/cache/archive/`)).toBe(true);
    expect(file.name.endsWith(".zip")).toBe(true);
    expect(progress).toEqual([0, 1, 2]);
    const seen = inspect(file.uri);
    const root = plan.root;
    expect(seen.names).toContain(`${root}/index.html`);
    expect(seen.names).toContain(`${root}/library.js`);
    expect(seen.names).toContain(`${root}/README.txt`);
    expect(seen.names).toContain(`${root}/记录/2026/2026-09-15 第一次挥手/正文.md`);
    expect(seen.sha[`${root}/记录/2026/2026-09-15 第一次挥手/照片1.jpg`]).toBe(sha256(photo));
    expect(seen.sha[`${root}/记录/2026/2026-09-15 第一次挥手/录音1.m4a`]).toBe(sha256(Buffer.alloc(1000, 7)));
    // 下一次导出清掉上一份。
    fs.writeFileSync(path.join(env.root, "cache", "archive", "old.zip"), "x");
    await createArchive(state, { year: NOW_YEAR });
    expect(fs.existsSync(path.join(env.root, "cache", "archive", "old.zip"))).toBe(false);
  });
  it("refuses when the device is short on space and leaves nothing behind", async () => {
    const { state } = seed();
    const needed = estimateArchiveBytes(planArchive(state, {}));
    expect(needed).toBeGreaterThan(301_000);
    env.free = needed - 1;
    await expect(createArchive(state, {})).rejects.toThrow("剩余空间不够");
    expect(fs.existsSync(path.join(env.root, "cache", "archive"))).toBe(false);
  });
  it("stops on request and deletes the partial file", async () => {
    const { state } = seed();
    const controller = new AbortController();
    await expect(
      createArchive(state, {}, (p) => {
        if (p.done === 1) controller.abort();
      }, controller.signal),
    ).rejects.toBeInstanceOf(ArchiveStopped);
    expect(fs.readdirSync(path.join(env.root, "cache", "archive"))).toEqual([]);
  });
  it("fails whole when a media file is missing or truncated", async () => {
    const { state } = seed();
    fs.truncateSync(path.join(env.root, "documents", "anan-v1", "media", "a.m4a"), 10);
    await expect(createArchive(state, {})).rejects.toThrow("素材缺失或损坏：a.m4a");
    expect(fs.readdirSync(path.join(env.root, "cache", "archive"))).toEqual([]);
  });
});
