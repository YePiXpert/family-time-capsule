import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// 真跑 backup.ts 的 discardPickedCopies，文件系统用磁盘假件（env.root 下）。
const env = vi.hoisted(() => ({
  root: "",
  free: Number.POSITIVE_INFINITY,
  rejectActivation: false,
}));
vi.mock("expo-crypto", async () => ({
  randomUUID: (await import("node:crypto")).randomUUID,
}));
vi.mock("expo-sharing", () => ({
  isAvailableAsync: async () => true,
  shareAsync: async () => {},
}));
vi.mock("expo-image-manipulator", () => ({ SaveFormat: { JPEG: "jpeg" } }));
vi.mock("expo-video-thumbnails", () => ({}));
vi.mock("expo-file-system", async () =>
  (await import("./helpers/expo-file-system-fake")).createExpoFileSystemFake(
    env,
  ),
);

beforeEach(() => {
  vi.resetModules();
  env.root = fs.mkdtempSync(path.join(os.tmpdir(), "anan-picked-"));
});
afterEach(() => {
  fs.rmSync(env.root, { recursive: true, force: true });
});
function put(relative: string) {
  const p = path.join(env.root, relative);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "xmb");
  return p;
}
async function load() {
  const { File } = await import("expo-file-system");
  const backup: Partial<typeof import("../src/local/backup")> = await import(
    "../src/local/backup"
  );
  // 修复前没有这个导出：落成断言失败，而不是调用时崩掉。
  expect(backup.discardPickedCopies).toBeTypeOf("function");
  return { File, discard: backup.discardPickedCopies! };
}

it("只删选择器复制进缓存 DocumentPicker 里的备份，别处的文件一个不碰", async () => {
  const { File, discard } = await load();
  const picked = [
    put("cache/DocumentPicker/7F2A/安安-备份.xmb"),
    put("cache/DocumentPicker/9C1B/安安-备份-2.xmb"),
  ];
  // 用户自己的文件、本机恢复记录、导出缓存：都不是选择器的副本。
  const others = [
    put("Documents/我的备份.xmb"),
    put("backups/恢复前-20260925.xmb"),
    put("cache/export/安安-备份-1.xmb"),
  ];
  discard([...picked, ...others].map((p) => new File(p)));
  for (const p of picked) expect(fs.existsSync(p)).toBe(false);
  for (const p of others) expect(fs.existsSync(p)).toBe(true);
});
it("副本已经不在或删不掉时不抛错，其余照删", async () => {
  const { File, discard } = await load();
  const gone = path.join(env.root, "cache/DocumentPicker/0000/已清.xmb");
  const kept = put("cache/DocumentPicker/1111/还在.xmb");
  const locked = new File(put("cache/DocumentPicker/2222/删不掉.xmb"));
  locked.delete = () => {
    throw new Error("EPERM");
  };
  expect(() => discard([new File(gone), locked, new File(kept)])).not.toThrow();
  expect(fs.existsSync(kept)).toBe(false);
});
