import * as fs from "node:fs";
import * as path from "node:path";
/**
 * vitest 里的 expo-file-system 假件：真写磁盘（env.root 下），只模拟 App 用到的那部分 API。
 * 备份、归档、远端备份的测试共用；env 由各测试文件用 vi.hoisted 提供。
 */
export type FakeEnv = {
  root: string;
  free: number;
  rejectActivation: boolean;
};
export function createExpoFileSystemFake(env: FakeEnv) {
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
      return fs
        .readdirSync(this.uri)
        .map((n) =>
          fs.statSync(target([this.uri, n])).isDirectory()
            ? new Directory(this, n)
            : new File(this, n),
        );
    }
    delete() {
      fs.rmSync(this.uri, { recursive: true });
    }
    rename(name: string) {
      const to = target([path.dirname(this.uri), name]);
      fs.renameSync(this.uri, to);
      this.uri = to;
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
    create(options?: { overwrite?: boolean; intermediates?: boolean }) {
      if (options?.intermediates)
        fs.mkdirSync(path.dirname(this.uri), { recursive: true });
      fs.writeFileSync(this.uri, "", { flag: options?.overwrite ? "w" : "wx" });
    }
    write(value: string | Uint8Array) {
      fs.writeFileSync(this.uri, value);
    }
    async text() {
      return fs.readFileSync(this.uri, "utf8");
    }
    delete() {
      fs.unlinkSync(this.uri);
    }
    rename(name: string) {
      const to = target([path.dirname(this.uri), name]);
      fs.renameSync(this.uri, to);
      this.uri = to;
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
      // 真机上 move 是异步的：先让出一轮，紧接着的同步读才会像真机一样看到「还没到位」。
      await new Promise((resolve) => setTimeout(resolve, 0));
      fs.renameSync(this.uri, to.uri);
      this.uri = to.uri;
    }
    moveSync(to: File) {
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
      get cache() {
        return new Directory(env.root, "cache");
      },
      get availableDiskSpace() {
        return env.free;
      },
    },
  };
}
