/// <reference types="node" />
import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { Credentials } from "../src/types";

/**
 * FIND-2 / M7-b 原生离线搜索：
 * - 只搜这台设备已保存/缓存的内容，范围明确；
 * - 索引按 (serverUrl, instanceId, token, userId, familyId) scope 隔离；
 * - 撤权/换号/清缓存后，对应家庭的搜索结果必须消失；
 * - 本机记录属于设备主人，始终可搜。
 */

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "sha256" },
  digestStringAsync: async (_algorithm: string, value: string) => hash(value),
}));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "/tmp/fictional/",
  makeDirectoryAsync: async () => true,
  deleteAsync: async () => true,
  readDirectoryAsync: async () => [] as string[],
  getInfoAsync: async () => ({ exists: false, isDirectory: false }),
  copyAsync: async () => true,
  moveAsync: async () => true,
  writeAsStringAsync: async () => true,
  readAsStringAsync: async () => "",
  createDownloadResumable: () => ({ downloadAsync: async () => null }),
}));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(public uri: string) {}
    async exists() { return false; }
    async create() {}
    async delete() {}
    async text() { return ""; }
    async write() {}
  },
}));

const { initializeLocalStore, getDatabase, clearServerCaches, clearLocalArchive } = await import("../src/storage/database");
const { memoryCacheScope } = await import("../src/memories/cache-scope");
const { offlineSearch } = await import("../src/search/offline-search");

const credentialsA = { serverUrl: "https://family-a.example.test", token: "token-a", instanceId: "instance-a" } as Credentials;
const credentialsB = { serverUrl: "https://family-b.example.test", token: "token-b", instanceId: "instance-a" } as Credentials;
const userA = "user-a";
const familyA = "family-a";
const scopeA = memoryCacheScope(credentialsA, userA, familyA)!;
const scopeB = memoryCacheScope(credentialsB, "user-b", "family-b")!;

beforeEach(async () => {
  await initializeLocalStore();
  const db = await getDatabase();
  // 阅读缓存库的表由 reading/native 惰性创建；测试里先补齐再清理。
  await db.execAsync(`CREATE TABLE IF NOT EXISTS reading_download(key TEXT PRIMARY KEY NOT NULL,scope TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,state TEXT NOT NULL,reserved_bytes INTEGER NOT NULL,stored_bytes INTEGER NOT NULL,error TEXT,updated_at INTEGER NOT NULL,manifest_json TEXT NOT NULL,completed_json TEXT NOT NULL,progress_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS reading_binding(credential_hash TEXT PRIMARY KEY NOT NULL,scope_json TEXT NOT NULL);`);
  for (const table of ["timeline_event", "memory_detail", "local_capture", "people", "reading_download", "reading_binding"]) {
    await db.runAsync(`DELETE FROM ${table}`);
  }
});

async function seedFamilyA() {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO timeline_event (id, title, occurred_at, occurred_at_precision, location_text, child_person_id, age_days, age_label, updated_at, asset_count, participant_names_json, cover_json, local_cover_uri, seen_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "memory-1", "公园的下午", "2026-09-01T00:00:00.000Z", "exact", "朝阳公园", null, null, null, "2026-09-01T00:00:00.000Z", 3,
    JSON.stringify(["外婆", "小满"]), "{}", null, 1,
  );
  await db.runAsync(
    `INSERT INTO memory_detail (scope, id, detail_json, updated_at) VALUES (?, ?, ?, ?)`,
    scopeA, "memory-1",
    JSON.stringify({ title: "公园的下午", locationText: "朝阳公园", sourceNotes: "外婆说那天风很舒服，孩子一直笑。", participants: [] }),
    "2026-09-01T00:00:00.000Z",
  );
  await db.runAsync(
    `INSERT INTO memory_detail (scope, id, detail_json, updated_at) VALUES (?, ?, ?, ?)`,
    scopeA, "memory-private",
    JSON.stringify({ title: "私密事件", sourceNotes: "只属于 A 家庭的私密讲述：夜里发烧的记录。", participants: [] }),
    "2026-09-02T00:00:00.000Z",
  );
  await db.runAsync(
    `INSERT INTO memory_detail (scope, id, detail_json, updated_at) VALUES (?, ?, ?, ?)`,
    scopeB, "memory-b1",
    JSON.stringify({ title: "B 家庭的秘密", sourceNotes: "夜里发烧的记录也出现在 B。", participants: [] }),
    "2026-09-02T00:00:00.000Z",
  );
  await db.runAsync(
    `INSERT INTO local_capture (id, kind, title, occurred_at, local_uri, media_type, inbox_item_id, memory_event_id, sync_state, payload_json, title_source, title_revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "capture-1", "text_capture", "买菜路上的随手记", "2026-09-03T00:00:00.000Z", null, null, null, null, "pending",
    JSON.stringify({ text: "楼下的桂花开了，买了一条鱼。" }), "legacy_unknown", 0,
  );
}

async function seedReadingDownload(scopeKey: string, key: string, title: string, manifestText: string) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO reading_download (key, scope, kind, id, title, state, reserved_bytes, stored_bytes, error, updated_at, manifest_json, completed_json, progress_json)
     VALUES (?, ?, 'collection', ?, ?, 'completed', 1, 1, NULL, 1, ?, '{}', '{}')`,
    key, scopeKey, key.replace(/.*-/, ""), title, JSON.stringify({ title, blocks: [{ text: manifestText }] }),
  );
}

it("离线搜索找到本机已保存的记忆、深文本与人物名，且严格按 scope 隔离", async () => {
  await seedFamilyA();
  // 标题命中
  const byTitle = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "公园的下午" });
  expect(byTitle.filter((item) => item.kind === "memory" && item.id === "memory-1").length).toBeGreaterThan(0);
  // 详情深文本命中（讲述原文）
  const byDeepText = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "夜里发烧" });
  expect(byDeepText.map((item) => item.id)).toContain("memory-private");
  expect(byDeepText.map((item) => item.id)).not.toContain("memory-b1");
  // 人物名命中（通过时间轴参与人）
  const byPerson = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "外婆" });
  expect(byPerson.map((item) => item.id)).toContain("memory-1");
  // 本机记录命中
  const byLocal = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "桂花" });
  expect(byLocal.map((item) => item.id)).toContain("capture-1");
  expect(byLocal.find((item) => item.id === "capture-1")!.kind).toBe("local");
  // 换成 B 家庭的 scope：A 的记忆一概不可见，只剩设备主人的本机记录
  const asB = await offlineSearch({ credentials: credentialsB, userId: "user-b", familyId: "family-b", query: "夜里发烧" });
  expect(asB.map((item) => item.id)).toContain("memory-b1");
  expect(asB.map((item) => item.id)).not.toContain("memory-private");
});

it("没有 scope（未连接）时仍可搜索本机记录", async () => {
  await seedFamilyA();
  const noServer = await offlineSearch({ credentials: null, query: "桂花" });
  expect(noServer.map((item) => item.id)).toContain("capture-1");
  expect(noServer.every((item) => item.kind === "local")).toBe(true);
});

it("已下载的相册/作品按阅读 scope 命中；其他 scope 不出现", async () => {
  await seedFamilyA();
  const readingScopeKey = hash(JSON.stringify([credentialsA.serverUrl, credentialsA.instanceId, userA, familyA]));
  const otherScopeKey = hash(JSON.stringify([credentialsA.serverUrl, credentialsA.instanceId, "user-x", "family-x"]));
  await seedReadingDownload(readingScopeKey, `${readingScopeKey}/collection-album-1`, "外婆的相册", "那年夏天我们在海边捡贝壳");
  await seedReadingDownload(otherScopeKey, `${otherScopeKey}/collection-album-2`, "别人的相册", "那年夏天我们在海边捡贝壳");
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO reading_binding (credential_hash, scope_json) VALUES (?, ?)`,
    hash(JSON.stringify([credentialsA.serverUrl, credentialsA.instanceId, credentialsA.token])),
    JSON.stringify({ key: readingScopeKey, serverUrl: credentialsA.serverUrl, userId: userA, familyId: familyA }),
  );
  const hits = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "贝壳" });
  const reading = hits.filter((item) => item.kind === "reading");
  expect(reading.map((item) => item.title)).toContain("外婆的相册");
  expect(reading.map((item) => item.title)).not.toContain("别人的相册");
});

it("撤权/换目的地（clearServerCaches）后记忆索引消失，本机记录保留", async () => {
  await seedFamilyA();
  await clearServerCaches();
  const afterSwitch = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "夜里发烧" });
  expect(afterSwitch.filter((item) => item.kind === "memory")).toHaveLength(0);
  const localStill = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "桂花" });
  expect(localStill.map((item) => item.id)).toContain("capture-1");
  // 清除本机全部数据后本机记录也消失
  await clearLocalArchive();
  const afterClear = await offlineSearch({ credentials: null, query: "桂花" });
  expect(afterClear).toHaveLength(0);
});
