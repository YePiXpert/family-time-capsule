import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-av-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "av-setup-token";
process.env.AUTH_SECRET = "av-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "av-setup-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { completeOnboarding } = await import("@/lib/family/service");
const { ingestMedia } = await import("@/lib/assets/ingest");
const { getAssetStorage } = await import("@/lib/assets/storage");
const {
  createInboxItemForAsset,
  createTextInboxItem,
  getInboxEntry,
} = await import("@/lib/inbox/service");
const { confirmInboxEntry, getMemoryEventDetail } = await import(
  "@/lib/memories/service"
);

const db = getDb();
const adminUserId = (await db.select({ id: userTable.id }).from(userTable))[0].id;
const onboarding = await completeOnboarding(adminUserId, {
  familyName: "我们一家",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2026-08-10",
  selfDisplayName: "爸爸",
  selfRelationToChild: "爸爸",
});
if (!onboarding.ok) throw new Error("onboarding failed");
const familyId = onboarding.familyId;

const fixtures = path.join(__dirname, "..", "fixtures");
const WAV = readFileSync(path.join(fixtures, "sample.wav"));
const MP4 = readFileSync(path.join(fixtures, "sample.mp4"));

describe("音频摄取（#011）", () => {
  it("WAV 入库：原件保留、file_metadata 时间、可读取字节一致", async () => {
    const lastModified = new Date("2026-08-20T08:00:00Z").getTime();
    const result = await ingestMedia({
      familyId,
      createdByUserId: adminUserId,
      kind: "audio",
      filename: "语音备忘录 42.m4a",
      declaredMime: "audio/wav",
      buffer: WAV,
      clientLastModifiedMs: lastModified,
    });
    expect(result.status).toBe("stored");
    if (result.status !== "stored") return;
    const row = result.asset;

    expect(row.type).toBe("audio");
    expect(row.mimeType).toBe("audio/wav");
    expect(row.storageKey).toMatch(/^originals\/[^/]+\/2026\/08\/[0-9a-f-]{36}\.wav$/);
    expect(row.timeSource).toBe("file_metadata");
    expect(row.capturedAt?.toISOString()).toBe("2026-08-20T08:00:00.000Z");
    // 文件名清洗（空格保留，路径分隔符去除）
    expect(row.originalFilename).toBe("语音备忘录 42.m4a");
    // 原件字节原封不动
    const storage = getAssetStorage();
    expect(storage.read(row.storageKey).equals(WAV)).toBe(true);
  });

  it("同一音频再次上传 → duplicate", async () => {
    const result = await ingestMedia({
      familyId,
      createdByUserId: adminUserId,
      kind: "audio",
      filename: "same.wav",
      declaredMime: "audio/wav",
      buffer: WAV,
      clientLastModifiedMs: null,
    });
    expect(result.status).toBe("duplicate");
  });

  it("伪装内容被拒绝且不落盘", async () => {
    const exe = Buffer.concat([Buffer.from("MZ\x90\x00"), Buffer.alloc(128, 0x41)]);
    const result = await ingestMedia({
      familyId,
      createdByUserId: adminUserId,
      kind: "audio",
      filename: "virus.wav",
      declaredMime: "audio/wav",
      buffer: exe,
      clientLastModifiedMs: null,
    });
    expect(result).toEqual({ status: "rejected", error: "content_mismatch" });
  });
});

describe("视频摄取（#011）", () => {
  it("MP4 入库（无 ffprobe 时 duration 为 null，流程不失败）", async () => {
    const result = await ingestMedia({
      familyId,
      createdByUserId: adminUserId,
      kind: "video",
      filename: "../../逃逸/第一次走路.mp4",
      declaredMime: "video/mp4",
      buffer: MP4,
      clientLastModifiedMs: new Date("2026-08-25T10:00:00Z").getTime(),
    });
    expect(result.status).toBe("stored");
    if (result.status !== "stored") return;
    const row = result.asset;
    expect(row.type).toBe("video");
    // 恶意文件名不进入路径
    expect(row.storageKey).not.toContain("..");
    expect(row.storageKey).toMatch(/\.mp4$/);
    // ffprobe 缺失（本机）→ durationMs null；核心上传不受影响
    expect(row.durationMs === null || typeof row.durationMs === "number").toBe(true);
  });

  it("MP4 声明成 audio 被拒绝", async () => {
    const result = await ingestMedia({
      familyId,
      createdByUserId: adminUserId,
      kind: "audio",
      filename: "x.mp4",
      declaredMime: "audio/mpeg",
      buffer: MP4,
      clientLastModifiedMs: null,
    });
    expect(result).toEqual({ status: "rejected", error: "content_mismatch" });
  });
});

describe("文字摄取（#011）", () => {
  it("文字条目 → 确认 → 事件（occurredAt 兜底条目时间）", async () => {
    const item = await createTextInboxItem(familyId, "小满第一次叫妈妈。");
    const entry = (await getInboxEntry(familyId, item.id))!;
    const result = await confirmInboxEntry(familyId, entry, { title: "第一声妈妈" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const detail = (await getMemoryEventDetail(familyId, result.eventId))!;
    expect(detail.event.title).toBe("第一声妈妈");
    expect(detail.event.occurredAt.getTime()).toBeGreaterThan(0);
  });

  it("音频入箱并确认：事件含可回放素材", async () => {
    const variant = Buffer.concat([WAV, Buffer.from([0x01])]);
    const stored = await ingestMedia({
      familyId,
      createdByUserId: adminUserId,
      kind: "audio",
      filename: "外婆唱的摇篮曲.wav",
      declaredMime: "audio/wav",
      buffer: variant,
      clientLastModifiedMs: null,
    });
    if (stored.status !== "stored") throw new Error("store failed");
    const item = await createInboxItemForAsset(familyId, stored.asset);
    expect(item.status).toBe("needs_review"); // import_time（本机无 ffprobe）

    const entry = (await getInboxEntry(familyId, item.id))!;
    const result = await confirmInboxEntry(familyId, entry, {
      title: "外婆的摇篮曲",
    });
    if (!result.ok) throw new Error("confirm failed");
    const detail = (await getMemoryEventDetail(familyId, result.eventId))!;
    expect(detail.assets[0].type).toBe("audio");
    // 原件仍可读
    const storage = getAssetStorage();
    expect(storage.read(detail.assets[0].storageKey).equals(variant)).toBe(true);
  });
});
