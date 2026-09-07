/// <reference types="node" />
import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { Credentials } from "../src/types";

/**
 * FIND-2 / M7-b 原生离线搜索（正式 1.0 投影式重写）：
 * - 只搜这台设备已保存/缓存的内容，范围明确；
 * - 缓存逐行 scope 隔离（timeline_event.scope），不再依赖换号清空；
 * - 只投影允许展示字段：token/内部路径/整个 JSON 绝不参与匹配或摘要；
 * - 损坏 JSON 单行跳过；筛选与去重；稳定排序。
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

async function seedTimeline(scope: string, id: string, title: string, occurredAt: string, participants: string[] = [], location: string | null = null) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO timeline_event (id, scope, title, occurred_at, occurred_at_precision, location_text, child_person_id, age_days, age_label, updated_at, asset_count, participant_names_json, cover_json, local_cover_uri, seen_snapshot)
     VALUES (?, ?, ?, ?, 'exact', ?, NULL, NULL, NULL, ?, 1, ?, '{}', NULL, 1)`,
    id, scope, title, occurredAt, location, occurredAt, JSON.stringify(participants),
  );
}

async function seedDetail(scope: string, id: string, detail: Record<string, unknown>, updatedAt = "2026-09-01T00:00:00.000Z") {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO memory_detail (scope, id, detail_json, updated_at) VALUES (?, ?, ?, ?)`,
    scope, id, JSON.stringify({ id, occurredAt: updatedAt, participants: [], ...detail }), updatedAt,
  );
}

async function seedLocalCapture(input: {
  id: string; title: string; occurredAt: string; payload: Record<string, unknown>;
  mediaType?: string | null; memoryEventId?: string | null; syncState?: string;
}) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO local_capture (id, kind, title, occurred_at, local_uri, media_type, inbox_item_id, memory_event_id, sync_state, payload_json, title_source, title_revision)
     VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, 'legacy_unknown', 0)`,
    input.id, input.mediaType ? "media_capture" : "text_capture", input.title, input.occurredAt,
    input.mediaType ?? null, input.memoryEventId ?? null, input.syncState ?? "pending", JSON.stringify(input.payload),
  );
}

async function seedReadingDownload(scopeKey: string, key: string, title: string, manifest: Record<string, unknown>) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO reading_download (key, scope, kind, id, title, state, reserved_bytes, stored_bytes, error, updated_at, manifest_json, completed_json, progress_json)
     VALUES (?, ?, 'collection', ?, ?, 'completed', 1, 1, NULL, 1, ?, '{}', '{}')`,
    key, scopeKey, key.replace(/.*-/, ""), title, JSON.stringify(manifest),
  );
}

async function seedFamilyA() {
  await seedTimeline(scopeA, "memory-1", "公园的下午", "2026-09-01T00:00:00.000Z", ["外婆", "小满"], "朝阳公园");
  await seedDetail(scopeA, "memory-1", { title: "公园的下午", locationText: "朝阳公园", sourceNotes: [{ id: "n1", text: "外婆说那天风很舒服，孩子一直笑。" }] });
  await seedDetail(scopeA, "memory-private", { title: "私密事件", sourceNotes: [{ id: "n2", text: "只属于 A 家庭的私密讲述：夜里发烧的记录。" }] });
  await seedDetail(scopeB, "memory-b1", { title: "B 家庭的秘密", sourceNotes: [{ id: "n3", text: "夜里发烧的记录也出现在 B。" }] });
  await seedLocalCapture({ id: "capture-1", title: "买菜路上的随手记", occurredAt: "2026-09-03T00:00:00.000Z", payload: { text: "楼下的桂花开了，买了一条鱼。" } });
}

it("离线搜索找到本机已保存的记忆、深文本与人物名，且严格按逐行 scope 隔离", async () => {
  await seedFamilyA();
  const byTitle = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "公园的下午" });
  expect(byTitle.filter((item) => item.kind === "memory" && item.id === "memory-1").length).toBeGreaterThan(0);
  const byDeepText = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "夜里发烧" });
  expect(byDeepText.map((item) => item.id)).toContain("memory-private");
  expect(byDeepText.map((item) => item.id)).not.toContain("memory-b1");
  const byPerson = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "外婆" });
  expect(byPerson.map((item) => item.id)).toContain("memory-1");
  const byLocal = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "桂花" });
  expect(byLocal.map((item) => item.id)).toContain("capture-1");
  expect(byLocal.find((item) => item.id === "capture-1")!.kind).toBe("local");
  // 逐行 scope：B 的时间轴行即使留在库里也不可见；A 换号后看不到 A 行。
  await seedTimeline(scopeB, "memory-b-timeline", "B 的时间轴事件", "2026-08-01T00:00:00.000Z");
  await seedTimeline("", "legacy-row", "无归属的旧行", "2026-07-01T00:00:00.000Z");
  const asB = await offlineSearch({ credentials: credentialsB, userId: "user-b", familyId: "family-b", query: "时间轴事件" });
  expect(asB.map((item) => item.id)).toContain("memory-b-timeline");
  const asA = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "时间轴事件" });
  expect(asA.map((item) => item.id)).not.toContain("memory-b-timeline");
  const noOwner = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "无归属" });
  expect(noOwner.map((item) => item.id)).not.toContain("legacy-row");
});

it("内部字段（token/路径/storageKey/JSON 结构）不参与匹配，也不出现在摘要里", async () => {
  await seedDetail(scopeA, "memory-internal", {
    title: "内部字段隔离",
    sourceNotes: [{ id: "n1", text: "正常的讲述内容：海边的风。" }],
    assets: [{ id: "asset-1", type: "image", filename: "IMG_2046.jpg", mediaPath: "/data/originals/secret-path-9f2c", thumbnailPath: null }],
    contributions: [{ id: "c1", authorName: "妈妈", text: "上传令牌是 sk-secret-token-value 吗", visibility: "family", canEdit: false, audioPath: null }],
  });
  await seedLocalCapture({
    id: "capture-path", title: "本机路径记录", occurredAt: "2026-09-04T00:00:00.000Z",
    payload: { text: "正文内容不含路径", localUri: "file:///data/user/0/private/dir/photo.jpg", fileName: "随手拍.jpg", mimeType: "image/jpeg" },
    mediaType: "image",
  });
  // 素材显示名可搜
  const byFilename = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "IMG_2046" });
  expect(byFilename.map((item) => item.id)).toContain("memory-internal");
  // 内部路径不可搜
  const byPath = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "secret-path-9f2c" });
  expect(byPath.map((item) => item.id)).not.toContain("memory-internal");
  // 讲述正文里的令牌字样按原话可搜（它是用户内容，不是内部字段泄露），
  // 但摘要只来自展示字段，不含 JSON 结构。
  const byToken = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "sk-secret-token-value" });
  const tokenHit = byToken.find((item) => item.id === "memory-internal");
  expect(tokenHit).toBeDefined();
  expect(tokenHit!.snippet).not.toContain("{");
  expect(tokenHit!.snippet).not.toContain("mediaPath");
  // 本机记录的 file:/// 路径不可搜
  const byLocalUri = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "file:///data/user/0" });
  expect(byLocalUri.map((item) => item.id)).not.toContain("capture-path");
  // 本机记录按文件显示名可搜
  const byLocalName = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "随手拍" });
  expect(byLocalName.map((item) => item.id)).toContain("capture-path");
});

it("损坏的 JSON 缓存单行跳过，不影响其余结果", async () => {
  const db = await getDatabase();
  await seedDetail(scopeA, "memory-good", { title: "完好的记忆", sourceNotes: [{ id: "n1", text: "海边捡贝壳" }] });
  await db.runAsync(
    `INSERT INTO memory_detail (scope, id, detail_json, updated_at) VALUES (?, ?, ?, ?)`,
    scopeA, "memory-broken", "{this is not valid json", "2026-09-02T00:00:00.000Z",
  );
  await seedLocalCapture({ id: "capture-broken", title: "损坏的本机记录", occurredAt: "2026-09-04T00:00:00.000Z", payload: { text: "海边" } });
  await db.runAsync(`UPDATE local_capture SET payload_json = '{broken' WHERE id = 'capture-broken'`);
  const hits = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "海边" });
  expect(hits.map((item) => item.id)).toContain("memory-good");
  expect(hits.map((item) => item.id)).not.toContain("memory-broken");
  expect(hits.map((item) => item.id)).not.toContain("capture-broken");
});

it("人物/日期/媒体类型筛选与去重、hasDetail 语义", async () => {
  await seedTimeline(scopeA, "memory-x", "雪天的火车", "2026-01-15T00:00:00.000Z", ["外公"], "哈尔滨");
  await seedDetail(scopeA, "memory-x", {
    title: "雪天的火车", sourceNotes: [], assets: [{ id: "a1", type: "video", filename: "train.mov", mediaPath: "/x", thumbnailPath: null }],
  });
  await seedTimeline(scopeA, "memory-y", "夏天的海边", "2026-07-20T00:00:00.000Z", ["外婆"]);
  // 人物筛选：外公参与的记忆才出现
  const byGrandpa = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "记忆", filters: { person: "外公" } });
  // 「记忆」不命中任何展示字段——换成宽泛词验证人物过滤
  const broad = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "的", filters: { person: "外公" } });
  expect(broad.map((item) => item.id)).toContain("memory-x");
  expect(broad.map((item) => item.id)).not.toContain("memory-y");
  expect(byGrandpa).toHaveLength(0);
  // 日期范围
  const winter = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "的", filters: { dateFrom: "2026-01-01", dateTo: "2026-02-28" } });
  expect(winter.map((item) => item.id)).toContain("memory-x");
  expect(winter.map((item) => item.id)).not.toContain("memory-y");
  // 媒体类型：只有 memory-x 的详情携带 video 素材
  const video = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "的", filters: { mediaType: "video" } });
  expect(video.map((item) => item.id)).toContain("memory-x");
  expect(video.map((item) => item.id)).not.toContain("memory-y");
  // hasDetail：时间轴命中 + 详情存在（即使详情没命中关键词）→ 可打开
  const byTimeline = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "夏天的海边" });
  const y = byTimeline.find((item) => item.id === "memory-y");
  expect(y?.hasDetail).toBe(false);
  await seedDetail(scopeA, "memory-y", { title: "夏天的海边" });
  const byTimelineAgain = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "夏天的海边" });
  expect(byTimelineAgain.find((item) => item.id === "memory-y")?.hasDetail).toBe(true);
  // 去重：已归档本机记录指向的服务器记忆已在结果中 → 不重复出现
  await seedLocalCapture({
    id: "capture-archived", title: "雪天的火车（本机副本）", occurredAt: "2026-01-15T00:00:00.000Z",
    payload: { text: "雪天" }, memoryEventId: "memory-x", syncState: "archived",
  });
  const dedup = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "雪天" });
  const ids = dedup.map((item) => item.id);
  expect(ids).toContain("memory-x");
  expect(ids).not.toContain("capture-archived");
  // 稳定排序：记忆按发生时间倒序
  const ordered = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "的" });
  const memoryOrder = ordered.filter((item) => item.kind === "memory").map((item) => item.id);
  expect(memoryOrder.indexOf("memory-y")).toBeLessThan(memoryOrder.indexOf("memory-x"));
});

it("没有 scope（未连接）时仍可搜索本机记录", async () => {
  await seedFamilyA();
  const noServer = await offlineSearch({ credentials: null, query: "桂花" });
  expect(noServer.map((item) => item.id)).toContain("capture-1");
  expect(noServer.every((item) => item.kind === "local")).toBe(true);
});

it("已下载的相册/作品按阅读 scope 命中（只搜投影字段）；其他 scope 不出现", async () => {
  await seedFamilyA();
  const readingScopeKey = hash(JSON.stringify([credentialsA.serverUrl, credentialsA.instanceId, userA, familyA]));
  const otherScopeKey = hash(JSON.stringify([credentialsA.serverUrl, credentialsA.instanceId, "user-x", "family-x"]));
  const manifest = {
    schemaVersion: 1, kind: "collection", id: "album-1", revision: 1, digest: "abc", userId: "user-a", familyId: "family-a",
    title: "外婆的相册", subtitle: "", timezone: "Asia/Shanghai",
    chapters: [{ id: "ch1", title: "第一章", blocks: [{ id: "b1", kind: "text", text: "那年夏天我们在海边捡贝壳", caption: "", images: [] }] }],
    media: [], bytes: 1,
  };
  await seedReadingDownload(readingScopeKey, `${readingScopeKey}/collection-album-1`, "外婆的相册", manifest);
  await seedReadingDownload(otherScopeKey, `${otherScopeKey}/collection-album-2`, "别人的相册", manifest);
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
  // manifest 内部字段（digest/userId）不参与匹配
  const byDigest = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "digest-abc" });
  expect(byDigest.filter((item) => item.kind === "reading")).toHaveLength(0);
});

it("撤权/换目的地（clearServerCaches）后记忆索引消失，本机记录保留", async () => {
  await seedFamilyA();
  await clearServerCaches();
  const afterSwitch = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "夜里发烧" });
  expect(afterSwitch.filter((item) => item.kind === "memory")).toHaveLength(0);
  const localStill = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "桂花" });
  expect(localStill.map((item) => item.id)).toContain("capture-1");
  await clearLocalArchive();
  const afterClear = await offlineSearch({ credentials: null, query: "桂花" });
  expect(afterClear).toHaveLength(0);
});

it("查询长度与结果数量有界", async () => {
  await seedFamilyA();
  const longQuery = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "海".repeat(300) });
  expect(longQuery).toHaveLength(0);
  const capped = await offlineSearch({ credentials: credentialsA, userId: userA, familyId: familyA, query: "的", limit: 999 });
  expect(capped.length).toBeLessThanOrEqual(50);
});
