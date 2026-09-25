import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { createTransport, SyncError, type HttpClient, type Transport } from "../src/sync/transport";
import { objectIdOf } from "../src/sync/crypto";
import { startServer, type E2EServer } from "./helpers/e2e-server";

const env = vi.hoisted(() => ({
  root: "",
  free: Number.POSITIVE_INFINITY,
  rejectActivation: false,
  database: null as DatabaseSync | null,
}));
vi.mock("expo-file-system", async () =>
  (await import("./helpers/expo-file-system-fake")).createExpoFileSystemFake(env),
);
vi.mock("expo-sqlite", async () =>
  (await import("./helpers/expo-sqlite-fake")).createExpoSqliteFake(env),
);
vi.mock("expo-crypto", () => ({
  randomUUID,
  getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)),
}));
vi.mock("expo-sharing", () => ({ isAvailableAsync: async () => true, shareAsync: async () => {} }));
vi.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  manipulateAsync: async () => {
    const p = path.join(env.root, `cache-thumb-${randomUUID()}.jpg`);
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
const phoneRoots: string[] = [];
async function openPhone(root?: string) {
  if (!root) {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "anan-two-phones-"));
    phoneRoots.push(root);
  }
  env.database?.close();
  env.database = null;
  env.root = root;
  vi.resetModules();
  const files = await import("../src/local/files");
  const family = await import("../src/sync/family");
  const engine = await import("../src/sync/engine");
  const model = await import("../src/local/model");
  const state = await import("../src/sync/state");
  const conflicts = await import("../src/sync/conflicts");
  const format = await import("../src/local/backup-format");
  const { openLocalStore } = await import("../src/local/disk");
  const store = await openLocalStore();
  files.ensureDirectories();
  return { root, files, family, engine, model, state, conflicts, format, store };
}
type Phone = Awaited<ReturnType<typeof openPhone>>;
const nodeHttp: HttpClient = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body as BodyInit | undefined,
    signal: request.signal ?? AbortSignal.timeout(request.timeoutMs),
  });
  return { status: response.status, body: new Uint8Array(await response.arrayBuffer()) };
};
let server: E2EServer;
let base = "";
let adminToken = "";
let dadId = "";
const json = { "Content-Type": "application/json" };
beforeAll(async () => {
  server = await startServer();
  base = server.base;
  dadId = randomUUID();
  const setup = await fetch(`${base}/family/activate`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      activationCode: server.activationCode(),
      memberId: dadId,
      memberName: "爸爸",
      deviceName: "dad-1",
      publicKey: randomBytes(32).toString("base64url"),
      familyId: randomUUID(),
      keyId: "0123456789abcdef",
      recovery: {
        envelope: randomBytes(57).toString("base64"),
        verifier: createHash("sha256").update("ab".repeat(32)).digest("hex"),
      },
    }),
  });
  if (setup.status !== 201) throw new Error(await setup.text());
  adminToken = ((await setup.json()) as { token: string }).token;
}, 60000);
afterAll(async () => {
  await server?.stop();
});
afterEach(() => {
  env.database?.close();
  env.database = null;
});
beforeEach(async () => {
  if (!adminToken) return;
  const r = await fetch(`${base}/admin/backup`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
  expect(r.status).toBe(200);
});
/** 批准一台新手机：新家人或已有家人。返回令牌与设备 id。 */
async function pair(member: { id: string; name?: string; role?: "admin" | "member" }, name = "phone") {
  const claim = randomBytes(16).toString("hex");
  const created = await fetch(`${base}/pair/requests`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      publicKey: randomBytes(32).toString("base64url"),
      deviceName: name,
      claimHash: createHash("sha256").update(claim).digest("hex"),
    }),
  });
  expect(created.status).toBe(201);
  const { requestId } = (await created.json()) as { requestId: string };
  const approved = await fetch(`${base}/pair/requests/${requestId}/approve`, {
    method: "POST",
    headers: { ...json, Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      member,
      enc: randomBytes(32).toString("base64url"),
      ct: randomBytes(80).toString("base64url"),
    }),
  });
  expect(approved.status).toBe(200);
  const collected = await fetch(`${base}/pair/requests/${requestId}/collect`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ claim }),
  });
  const got = (await collected.json()) as { token: string; member: { deviceId: string } };
  const confirmed = await fetch(`${base}/pair/requests/${requestId}/confirm`, {
    method: "POST",
    headers: { ...json, Authorization: `Bearer ${got.token}` },
    body: "{}",
  });
  expect(confirmed.status).toBe(200);
  return { token: got.token, deviceId: got.member.deviceId };
}
async function revoke(deviceId: string) {
  const r = await fetch(`${base}/admin/devices/${deviceId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(r.status).toBe(200);
}
const transportOf = (token: () => string) => createTransport(nodeHttp, base, async () => token());
async function addRecord(
  p: Phone,
  id: string,
  opts: { text?: string; by?: string; photo?: number; audio?: number; draftOnly?: boolean; at?: string },
) {
  const mediaIds: string[] = [];
  const media: Record<string, { id: string; bytes: Buffer }> = {};
  for (const [kind, byte] of [["image", opts.photo], ["audio", opts.audio]] as const) {
    if (byte === undefined) continue;
    const bytes = Buffer.alloc(kind === "audio" ? 5000 : 3000, byte);
    const ext = kind === "audio" ? "m4a" : "jpg";
    const source = path.join(p.root, `${id}-${kind}.${ext}`);
    fs.writeFileSync(source, bytes);
    const m = await p.files.preserveMedia(source, `${id}.${ext}`, kind);
    mediaIds.push(m.id);
    media[kind] = { id: m.id, bytes };
    await p.store.change((s) => {
      s.media[m.id] = m;
    });
  }
  const at = opts.at ?? "2026-09-20T00:00:00Z";
  await p.store.change((s) => {
    s.drafts[id] = {
      id,
      recordId: null,
      baseRevision: 0,
      updatedAt: at,
      content: {
        ...p.model.emptyContent(),
        text: opts.text ?? `记录 ${id}`,
        ...(opts.by ? { by: opts.by } : {}),
        mediaIds,
        coverId: mediaIds[0] ?? null,
      },
    };
    if (!opts.draftOnly) p.model.saveRecord(s, id, `r-${id}`, at);
  });
  return media;
}
async function editRecord(p: Phone, rid: string, text: string, by: string, now: string, photo?: number) {
  let extra: string | undefined;
  if (photo !== undefined) {
    const source = path.join(p.root, `edit-${photo}.jpg`);
    fs.writeFileSync(source, Buffer.alloc(3100, photo));
    const m = await p.files.preserveMedia(source, `edit-${photo}.jpg`, "image");
    extra = m.id;
    await p.store.change((s) => {
      s.media[m.id] = m;
    });
  }
  await p.store.change((s) => {
    const record = s.records[rid]!;
    s.drafts.edit = {
      id: "edit",
      recordId: rid,
      baseRevision: record.revision,
      updatedAt: now,
      content: {
        ...p.model.clone(record),
        mediaIds: [...record.mediaIds, ...(extra ? [extra] : [])],
        text,
        by,
      },
    };
    p.model.saveRecord(s, "edit", rid, now);
  });
  return extra;
}
const bytesOf = (p: Phone, mediaId: string) => {
  const m = p.store.get().media[mediaId];
  if (!m) return null;
  const f = p.files.mediaFile(m);
  return f.exists ? fs.readFileSync(f.uri) : null;
};

// 每条用各自随机的家庭钥匙，前面用例留下的清单钥匙不同、会被跳过。
it("草稿与只被草稿用到的照片不进家里的清单；记录、照片、录音与落款双向到达", async () => {
  const key = new Uint8Array(randomBytes(16));
  const mom = await pair({ id: randomUUID(), name: `妈妈${randomUUID().slice(0, 4)}`, role: "member" }, "mom-drafts");
  const tA = transportOf(() => adminToken);
  const tB = transportOf(() => mom.token);
  let a = await openPhone();
  const rootA = a.root;
  const mediaA = await addRecord(a, "a1", { by: "爸爸", photo: 11, audio: 12 });
  const draftMedia = await addRecord(a, "priv", { text: "只在这台手机上的草稿", photo: 77, draftOnly: true });
  await a.family.joinFamily(a.store, key, { transport: tA });

  const b = await openPhone();
  await b.family.joinFamily(b.store, key, { transport: tB });
  const rec = b.store.get().records["r-a1"]!;
  expect(rec.by).toBe("爸爸");
  expect(bytesOf(b, mediaA.image!.id)?.equals(mediaA.image!.bytes)).toBe(true);
  expect(bytesOf(b, mediaA.audio!.id)?.equals(mediaA.audio!.bytes)).toBe(true);
  expect(Object.keys(b.store.get().drafts)).toEqual([]);

  // 家里任何一台手机都解得开清单：草稿与它独有的照片根本不该传上去。
  const aEntry = (await tB.manifests()).find((e) => e.deviceName === "dad-1")!;
  const man = await b.engine.fetchManifestOf(aEntry, { transport: tB, key });
  const lib = b.format.decodeLibraryV2(man.meta, man.entities);
  expect(Object.keys(lib.drafts)).toEqual([]);
  expect(lib.media[draftMedia.image!.id]).toBeUndefined();
  expect(lib.media[mediaA.image!.id]).toBeDefined();
  const draftSha = createHash("sha256").update(draftMedia.image!.bytes).digest("hex");
  expect((await tB.missing([objectIdOf(key, draftSha, 0)])).size).toBe(1);

  // 草稿之后保存成记录，下一轮才把它和照片发出去。
  const mediaB = await addRecord(b, "b1", { by: "妈妈", audio: 33 });
  await b.family.runFamilySync(b.store, { transport: tB, key });
  a = await openPhone(rootA);
  await a.family.runFamilySync(a.store, { transport: tA, key });
  expect(a.store.get().records["r-b1"]?.by).toBe("妈妈");
  expect(bytesOf(a, mediaB.audio!.id)?.equals(mediaB.audio!.bytes)).toBe(true);
  expect(a.store.get().drafts.priv?.content.text).toBe("只在这台手机上的草稿");
  await a.store.change((s) => { a.model.saveRecord(s, "priv", "r-priv", "2026-09-22T00:00:00Z"); });
  await a.family.runFamilySync(a.store, { transport: tA, key });
  const again = await openPhone();
  await again.family.joinFamily(again.store, key, { transport: tB });
  expect(again.store.get().records["r-priv"]?.text).toBe("只在这台手机上的草稿");
  expect(bytesOf(again, draftMedia.image!.id)?.equals(draftMedia.image!.bytes)).toBe(true);
}, 120000);

it("从草稿移出或随草稿放弃的照片也不发到家里", async () => {
  const key = new Uint8Array(randomBytes(16));
  const mom = await pair({ id: randomUUID(), name: `妈妈${randomUUID().slice(0, 4)}`, role: "member" }, "mom-discard");
  const tA = transportOf(() => adminToken);
  const tB = transportOf(() => mom.token);
  const a = await openPhone();
  await addRecord(a, "keep", { photo: 80 });
  const dropped = await addRecord(a, "gone", { text: "想了想不留", photo: 81, draftOnly: true });
  // 编辑页「放弃」只删草稿，照片还在本机素材里、谁也不引用。
  await a.store.change((s) => { delete s.drafts.gone; });
  expect(a.store.get().media[dropped.image!.id]).toBeDefined();
  await a.family.joinFamily(a.store, key, { transport: tA });
  const b = await openPhone();
  await b.family.joinFamily(b.store, key, { transport: tB });
  const aEntry = (await tB.manifests()).find((e) => e.deviceName === "dad-1")!;
  const man = await b.engine.fetchManifestOf(aEntry, { transport: tB, key });
  const lib = b.format.decodeLibraryV2(man.meta, man.entities);
  expect(Object.keys(lib.records)).toEqual(["r-keep"]);
  expect(lib.media[dropped.image!.id]).toBeUndefined();
  const sha = createHash("sha256").update(dropped.image!.bytes).digest("hex");
  expect((await tB.missing([objectIdOf(key, sha, 0)])).size).toBe(1);
}, 120000);
it("上传中途断线再重试：不重复上传；下载中途断线不动本机，重试后附件逐字节一致", async () => {
  const key = new Uint8Array(randomBytes(16));
  const mom = await pair({ id: randomUUID(), name: `妈妈${randomUUID().slice(0, 4)}`, role: "member" }, "mom-b2");
  const real = transportOf(() => adminToken);
  let puts = 0;
  const putIds: string[] = [];
  const flaky: Transport = {
    ...real,
    put: async (id, bytes, sha, signal) => {
      puts++;
      if (puts === 2) throw new SyncError("NETWORK", "现在连不上服务，请稍后再试。");
      putIds.push(id);
      return real.put(id, bytes, sha, signal);
    },
  };
  let a = await openPhone();
  const rootA = a.root;
  const m1 = await addRecord(a, "x1", { photo: 21 });
  const m2 = await addRecord(a, "x2", { photo: 22 });
  const m3 = await addRecord(a, "x3", { audio: 23 });
  await expect(a.family.joinFamily(a.store, key, { transport: flaky })).rejects.toThrow("连不上");
  a = await openPhone(rootA);
  await a.family.runFamilySync(a.store, { transport: flaky, key });
  const dup = putIds.filter((id, i) => putIds.indexOf(id) !== i);
  expect(dup).toEqual([]);
  const b = await openPhone();
  // download failure once, then retry
  const tB = transportOf(() => mom.token);
  let gets = 0;
  const flakyB: Transport = {
    ...tB,
    get: async (id, signal) => {
      gets++;
      if (gets === 3) throw new SyncError("NETWORK", "现在连不上服务，请稍后再试。");
      return tB.get(id, signal);
    },
  };
  await expect(b.family.joinFamily(b.store, key, { transport: flakyB })).rejects.toThrow("连不上");
  expect(Object.keys(b.store.get().records)).toEqual([]);
  await b.family.runFamilySync(b.store, { transport: flakyB, key });
  expect(Object.keys(b.store.get().records).sort()).toEqual(["r-x1", "r-x2", "r-x3"]);
  for (const m of [m1.image!, m2.image!, m3.audio!]) expect(bytesOf(b, m.id)?.equals(m.bytes)).toBe(true);
}, 120000);

it("两台离线改同一条、各加一张照片：新版留下，另一版与它的照片都能找回并换回", async () => {
  const key = new Uint8Array(randomBytes(16));
  const mom = await pair({ id: randomUUID(), name: `妈妈${randomUUID().slice(0, 4)}`, role: "member" }, "mom-b3");
  const tA = transportOf(() => adminToken);
  const tB = transportOf(() => mom.token);
  let a = await openPhone();
  const rootA = a.root;
  await addRecord(a, "c", { photo: 40 });
  await a.family.joinFamily(a.store, key, { transport: tA });
  let b = await openPhone();
  const rootB = b.root;
  await b.family.joinFamily(b.store, key, { transport: tB });
  a = await openPhone(rootA);
  const pA = (await editRecord(a, "r-c", "爸爸离线改", "爸爸", "2026-09-21T04:00:00Z", 41))!;
  const versionA = a.model.clone(a.store.get().records["r-c"]!);
  b = await openPhone(rootB);
  const pB = (await editRecord(b, "r-c", "妈妈离线改", "妈妈", "2026-09-21T05:00:00Z", 42))!;
  a = await openPhone(rootA);
  await a.family.runFamilySync(a.store, { transport: tA, key });
  b = await openPhone(rootB);
  await b.family.runFamilySync(b.store, { transport: tB, key });
  expect(b.store.get().records["r-c"]?.text).toBe("妈妈离线改");
  const cb = await b.state.readConflicts();
  expect(cb).toHaveLength(1);
  expect(cb[0]!.loser).toEqual(versionA);
  expect(bytesOf(b, pA)).not.toBeNull(); // loser's photo came along
  expect(b.conflicts.conflictMediaIds(cb).has(pA)).toBe(true);
  a = await openPhone(rootA);
  await a.family.runFamilySync(a.store, { transport: tA, key });
  expect(a.store.get().records["r-c"]?.text).toBe("妈妈离线改");
  expect(bytesOf(a, pB)).not.toBeNull();
  const ca = await a.state.readConflicts();
  expect(ca).toHaveLength(1);
  expect(ca[0]!.loser.text).toBe("爸爸离线改");
  // 用这一版 on A, sync, B gets A's version with pA
  await a.store.change((s) => a.conflicts.restoreLoser(s, ca[0]!, "2026-09-21T06:00:00Z"));
  expect(a.store.get().records["r-c"]?.mediaIds).toContain(pA);
  await a.family.runFamilySync(a.store, { transport: tA, key });
  b = await openPhone(rootB);
  await b.family.runFamilySync(b.store, { transport: tB, key });
  expect(b.store.get().records["r-c"]?.text).toBe("爸爸离线改");
  expect(b.store.get().records["r-c"]?.mediaIds).toContain(pA);
}, 120000);

it("停用手机的旧清单不会在新手机上复活已删除的记录", async () => {
  const key = new Uint8Array(randomBytes(16));
  const dad2 = await pair({ id: dadId }, "dad-2-b4");
  const tA = transportOf(() => adminToken);
  let a = await openPhone();
  const rootA = a.root;
  await addRecord(a, "k1", { photo: 50 });
  await addRecord(a, "k2", { photo: 51 });
  await a.family.joinFamily(a.store, key, { transport: tA });
  const a2 = await openPhone();
  await a2.family.joinFamily(a2.store, key, { transport: transportOf(() => dad2.token) });
  expect(Object.keys(a2.store.get().records).sort()).toEqual(["r-k1", "r-k2"]);
  await revoke(dad2.deviceId);
  a = await openPhone(rootA);
  await a.store.change((s) => a.model.deleteRecord(s, "r-k2", "2026-09-22T00:00:00Z"));
  await a.family.runFamilySync(a.store, { transport: tA, key });
  const dad3 = await pair({ id: dadId }, "dad-3-b4");
  const t3 = transportOf(() => dad3.token);
  const a3 = await openPhone();
  await a3.family.joinFamily(a3.store, key, { transport: t3 });
  expect(Object.keys(a3.store.get().records).sort()).toEqual(["r-k1"]);
}, 120000);

it("停用后重新获准的手机，第一次同步就发布自己的清单", async () => {
  const key = new Uint8Array(randomBytes(16));
  const momId = randomUUID();
  let momToken = (await pair({ id: momId, name: `妈妈${randomUUID().slice(0, 4)}`, role: "member" }, "mom-again")).token;
  const dev1 = ((await (await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${momToken}` } })).json()) as { member: { deviceId: string } }).member.deviceId;
  const tA = transportOf(() => adminToken);
  let a = await openPhone();
  const rootA = a.root;
  await addRecord(a, "e1", { photo: 70 });
  await a.family.joinFamily(a.store, key, { transport: tA });
  let b = await openPhone();
  const rootB = b.root;
  await b.family.joinFamily(b.store, key, { transport: transportOf(() => momToken) });
  await addRecord(b, "mm", { text: "妈妈刚写的", photo: 71 });
  await b.family.runFamilySync(b.store, { transport: transportOf(() => momToken), key });
  // 爸爸还没同步，妈妈这台被停用、又重新获准（换了设备号）。
  await revoke(dev1);
  momToken = (await pair({ id: momId }, "mom-again-2")).token;
  b = await openPhone(rootB);
  const result = await b.family.runFamilySync(b.store, { transport: transportOf(() => momToken), key });
  expect(result.lastSyncSummary?.pushed).toBeGreaterThan(0);
  a = await openPhone(rootA);
  await a.family.runFamilySync(a.store, { transport: tA, key });
  expect(a.store.get().records["r-mm"]?.text).toBe("妈妈刚写的");
}, 120000);
