import {
  afterAll,
  beforeAll,
  beforeEach,
  afterEach,
  expect,
  it,
  vi,
} from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { createTransport, type HttpClient } from "../src/sync/transport";
import { keyIdOf } from "../src/sync/crypto";
import { twoPhonesWriteTogether } from "./helpers/family-two-phones";
/**
 * 真端到端：拉起仓库里的真实服务端子进程（SQLite 临时库、对象库临时目录），
 * 手机端引擎经 Node fetch 版 HttpClient 跑「开启 → 上传 → 核对 → 换手机加入」。
 * 需要 server/ 已 npm ci（CI 的 quality 作业多装一次）。
 */
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
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked",
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
const serverDir = path.resolve(__dirname, "..", "..", "server");
let child: ChildProcess | null = null;
let serverRoot = "";
let base = "";
let token = "";
const phoneRoots: string[] = [];
function newPhoneRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anan-e2e-phone-"));
  phoneRoots.push(root);
  return root;
}
async function openPhone(root = newPhoneRoot()) {
  env.database?.close();
  env.database = null;
  env.root = root;
  vi.resetModules();
  const files = await import("../src/local/files");
  const family = await import("../src/sync/family");
  const model = await import("../src/local/model");
  const state = await import("../src/sync/state");
  const { openLocalStore } = await import("../src/local/disk");
  const store = await openLocalStore();
  files.ensureDirectories();
  return { root, files, family, model, state, store };
}
const nodeHttp: HttpClient = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body as BodyInit | undefined,
    signal: request.signal ?? AbortSignal.timeout(request.timeoutMs),
  });
  return {
    status: response.status,
    body: new Uint8Array(await response.arrayBuffer()),
  };
};
beforeAll(async () => {
  if (!fs.existsSync(path.join(serverDir, "node_modules")))
    throw new Error(
      "server/node_modules 不在：先在 server/ 里 npm ci，再跑端到端。",
    );
  serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "anan-e2e-server-"));
  fs.writeFileSync(path.join(serverRoot, "cpa-key"), "unused-in-e2e\n");
  const port = 20000 + Math.floor(Math.random() * 20000);
  base = `http://127.0.0.1:${port}/api/v1`;
  const clean = { ...process.env };
  for (const name of Object.keys(clean))
    if (/^(https?|all)_proxy$/i.test(name)) delete clean[name];
  const logs: string[] = [];
  child = spawn(process.execPath, ["src/index.ts"], {
    cwd: serverDir,
    env: {
      ...clean,
      DB_FILE: path.join(serverRoot, "ai.sqlite"),
      BACKUP_DIR: path.join(serverRoot, "backup"),
      AI_PROVIDER: "mimo",
      AI_MODEL: "mimo-v2.6-flash",
      AI_BASE_URL: "https://api.xiaomimimo.com/v1",
      AI_KEY_FILE: path.join(serverRoot, "cpa-key"),
      AI_ACCESS: "payg-approved", // Fake key; this sync-only fixture never calls AI.
      TRANSCRIBE_PROVIDER: "mimo",
      TRANSCRIBE_MODEL: "mimo-v2.5-asr",
      TRANSCRIBE_BASE_URL: "https://api.xiaomimimo.com/v1",
      TRANSCRIBE_KEY_FILE: path.join(serverRoot, "cpa-key"),
      TRANSCRIBE_ACCESS: "payg-approved",
      PORT: String(port),
      SOURCE_SHA: "e2e",
      NODE_NO_WARNINGS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d: Buffer) => logs.push(d.toString()));
  child.stderr?.on("data", (d: Buffer) => logs.push(d.toString()));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`服务端子进程退出了：\n${logs.join("")}`);
    try {
      const health = await fetch(`${base.replace(/\/api\/v1$/, "")}/healthz`);
      if (health.ok) break;
    } catch {
      // 还没起来
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const setup = await fetch(`${base}/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "e2eowner",
      password: "e2e-password-123",
      deviceName: "vitest",
    }),
  });
  if (setup.status !== 201)
    throw new Error(
      `setup 失败：${setup.status} ${await setup.text()}\n${logs.join("")}`,
    );
  token = ((await setup.json()) as { token: string }).token;
}, 60000);
afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child?.once("exit", resolve));
    child.kill("SIGTERM");
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  if (serverRoot) fs.rmSync(serverRoot, { recursive: true, force: true });
});
beforeEach(() => {
  vi.resetModules();
  env.free = Number.POSITIVE_INFINITY;
  env.rejectActivation = false;
  env.root = newPhoneRoot();
});
afterEach(() => {
  vi.restoreAllMocks();
  env.database?.close();
  env.database = null;
  for (const root of phoneRoots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
it("backs up to the real service, verifies, and joins from a wiped phone", async () => {
  const files = await import("../src/local/files");
  const family = await import("../src/sync/family");
  const engine = await import("../src/sync/engine");
  const { clearSyncFiles } = await import("../src/sync/state");
  const model = await import("../src/local/model");
  const { openLocalStore } = await import("../src/local/disk");
  const store = await openLocalStore();
  files.ensureDirectories();
  const bigBytes = Buffer.alloc(4 * 1048576 + 7, 23);
  const photos: { id: string; bytes: Buffer }[] = [
    { id: "big", bytes: bigBytes },
    { id: "small", bytes: Buffer.alloc(2048, 91) },
  ];
  const mediaIds: Record<string, string> = {};
  for (const photo of photos) {
    const source = path.join(env.root, `${photo.id}.jpg`);
    fs.writeFileSync(source, photo.bytes);
    const media = await files.preserveMedia(source, `${photo.id}.jpg`, "image");
    mediaIds[photo.id] = media.id;
    await store.change((s) => {
      s.welcome = true;
      s.media[media.id] = media;
      s.drafts[photo.id] = {
        id: photo.id,
        recordId: null,
        baseRevision: 0,
        updatedAt: new Date().toISOString(),
        content: {
          ...model.emptyContent(),
          text: `记录 ${photo.id}`,
          mediaIds: [media.id],
          coverId: media.id,
        },
      };
      model.saveRecord(s, photo.id, `r-${photo.id}`, new Date().toISOString());
    });
  }
  const key = new Uint8Array(randomBytes(16));
  const transport = createTransport(nodeHttp, base, async () => token);
  const stages: string[] = [];
  const result = await family.runFamilySync(store, {
    transport,
    key,
    onProgress: (stage) => stages.push(stage),
  });
  expect(result.lastSyncSummary?.objects).toBe(4);
  const status = await transport.status();
  expect(status.keyId).toBe(keyIdOf(key));
  expect(status.objects).toBe(4);
  expect(status.bytes).toBeGreaterThan(4 * 1048576);
  // 服务器磁盘上只有密文：对象文件里找不到照片的字节。
  const stored = fs
    .readdirSync(path.join(serverRoot, "backup"), { recursive: true })
    .map(String)
    .filter((n) => /[a-f0-9]{64}$/.test(n) && !n.endsWith(".part"));
  expect(stored).toHaveLength(4);
  const run = Buffer.alloc(4096, 23);
  for (const name of stored) {
    const bytes = fs.readFileSync(path.join(serverRoot, "backup", name));
    expect(bytes.includes(run)).toBe(false);
    expect(bytes.subarray(0, 8).toString()).toBe("ANANOBJ1");
  }
  const summary = await engine.verifyRemoteBackup({ transport, key });
  expect(summary.objects).toBe(4);
  // 内容没变：不再上传清单对象，也不重发索引。
  await family.runFamilySync(store, { transport, key });
  expect((await transport.status()).objects).toBe(4);
  // 换手机：blob 库、保留备份、记录与本机同步基都没了，只剩恢复码。
  fs.rmSync(files.blobDirectory.uri, { recursive: true });
  for (const f of fs.readdirSync(files.backupDirectory.uri))
    fs.unlinkSync(path.join(files.backupDirectory.uri, f));
  await store.change((s) => {
    Object.assign(s, model.emptyLibrary());
  });
  clearSyncFiles();
  expect(Object.keys(store.get().records)).toEqual([]);
  await family.joinFamily(store, key, {
    transport,
    onProgress: (s) => stages.push(s),
  });
  expect(store.get().records["r-big"]?.text).toBe("记录 big");
  expect(store.get().records["r-small"]?.text).toBe("记录 small");
  const restoredBig = fs.readFileSync(
    files.mediaFile(store.get().media[mediaIds.big!]!).uri,
  );
  expect(restoredBig.equals(bigBytes)).toBe(true);
  expect(stages).toContain("正在下载 2/2");
  // 错的恢复码：服务端存的 keyId 让它在下载任何对象前就被判出。
  await expect(
    family.joinFamily(store, new Uint8Array(randomBytes(16)), { transport }),
  ).rejects.toThrow("恢复码");
  // 删库（Build 72 服务端）：只作废自己名下的清单；对象是全家的，一小时内的新对象留给 prune 收。
  await transport.wipe();
  expect(await transport.getManifest()).toBeNull();
  expect((await transport.status()).keyId).toBeNull();
}, 120000);
it("两台手机一起写 through the real service", async () => {
  const member = { username: "e2emom", password: "e2e-password-456" };
  const created = await fetch(`${base}/admin/members`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(member),
  });
  expect(created.status).toBe(201);
  const login = await fetch(`${base}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...member, deviceName: "vitest-b" }),
  });
  expect(login.status).toBe(200);
  const tokenB = ((await login.json()) as { token: string }).token;
  expect(tokenB).toBeTruthy();
  const transportA = createTransport(nodeHttp, base, async () => token);
  const transportB = createTransport(nodeHttp, base, async () => tokenB);
  const objectFiles = () =>
    new Set(
      fs.readdirSync(path.join(serverRoot, "backup"), { recursive: true })
        .map((name) => path.basename(String(name)))
        .filter((name) => /^[a-f0-9]{64}$/.test(name)),
    );
  // 前一例撤掉清单后，其密文对象仍在服务端一小时宽限期内。
  const before = objectFiles();
  await twoPhonesWriteTogether({
    openPhone,
    transportA,
    transportB,
    key: new Uint8Array(randomBytes(16)),
    checkObjects: async (expected) => {
      const added = new Set(
        [...objectFiles()].filter((id) => !before.has(id)),
      );
      expect(added).toEqual(expected);
      expect((await transportA.status()).objects).toBe(
        before.size + expected.size,
      );
    },
  });
}, 180000);
