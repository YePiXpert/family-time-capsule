import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * RH-002：Live Photo 安全摄取基础。
 * P0.1 不做 Apple Live Photo 自动识别：HEIC/JPEG（静帧）+ MOV（动帧）
 * 是两个独立 Asset，可同时上传、独立保存、独立 SHA-256、进 Inbox、
 * 由用户合并为同一个 MemoryEvent。绝不自动删除任何一方。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-live-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "live-token";
process.env.AUTH_SECRET = "live-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "live-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { completeOnboarding } = await import("@/lib/family/service");
const { ingestImage, ingestMedia } = await import("@/lib/assets/ingest");
const { sha256Of } = await import("@/lib/assets/service");
const { getAssetStorage } = await import("@/lib/assets/storage");
const {
  createInboxItemForAsset,
  getInboxEntry,
  listInbox,
} = await import("@/lib/inbox/service");
const {
  mergeInboxEntries,
  getMemoryEventDetail,
} = await import("@/lib/memories/service");

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

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "..", "fixtures", name));

describe("Live Photo（静帧 + 动帧）安全摄取", () => {
  it("HEIC 静帧 + MOV 动帧：同时上传、独立原件、独立 SHA-256、都进 Inbox", async () => {
    // 同一“瞬间”的两个文件（Apple 导出时常见组合）
    const still = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "IMG_2048.HEIC",
      declaredMime: "image/heic",
      buffer: fixture("sample.heic"),
      clientLastModifiedMs: new Date("2026-08-15T05:00:00Z").getTime(),
    });
    expect(still.status).toBe("stored");
    if (still.status !== "stored") return;

    const motion = await ingestMedia({
      familyId,
      createdByUserId: adminUserId,
      kind: "video",
      filename: "IMG_2048.MOV",
      declaredMime: "video/quicktime",
      buffer: fixture("sample.mov"),
      clientLastModifiedMs: new Date("2026-08-15T05:00:00Z").getTime(),
    });
    expect(motion.status).toBe("stored");
    if (motion.status !== "stored") return;

    const stillItem = await createInboxItemForAsset(familyId, still.asset);
    const motionItem = await createInboxItemForAsset(familyId, motion.asset);

    // 两个独立收件箱条目
    const inbox = await listInbox(familyId);
    expect(inbox.map((e) => e.item.id)).toContain(stillItem.id);
    expect(inbox.map((e) => e.item.id)).toContain(motionItem.id);

    // 独立 SHA-256、独立文件
    expect(still.asset.sha256).not.toBe(motion.asset.sha256);
    const storage = getAssetStorage();
    expect(storage.exists(still.asset.storageKey)).toBe(true);
    expect(storage.exists(motion.asset.storageKey)).toBe(true);
    expect(still.asset.storageKey).not.toBe(motion.asset.storageKey);

    // 用户合并为一个 MemoryEvent
    const merged = await mergeInboxEntries(
      familyId,
      [stillItem.id, motionItem.id],
      { title: "窗边的那个下午" },
    );
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;

    const detail = (await getMemoryEventDetail(familyId, merged.eventId))!;
    expect(detail.assets).toHaveLength(2);
    const types = detail.assets.map((a) => a.type).sort();
    expect(types).toEqual(["image", "video"]);
    // 封面默认选图片（静帧）
    expect(detail.event.coverAssetId).toBe(still.asset.id);

    // 合并后两个原件都完好、未被复制或删除
    const { getAsset } = await import("@/lib/assets/service");
    const stillRow = await getAsset(familyId, still.asset.id);
    const motionRow = await getAsset(familyId, motion.asset.id);
    expect(stillRow?.sha256).toBe(sha256Of(fixture("sample.heic")));
    expect(motionRow?.sha256).toBe(sha256Of(fixture("sample.mov")));
    expect(storage.read(stillRow!.storageKey).equals(fixture("sample.heic"))).toBe(true);
    expect(storage.read(motionRow!.storageKey).equals(fixture("sample.mov"))).toBe(true);
  });

  it("JPEG 静帧 + MOV 组合同样可合并（Android/导出场景）", async () => {
    const still = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "photo_2026.jpg",
      declaredMime: "image/jpeg",
      buffer: Buffer.concat([fixture("sample.jpg"), Buffer.from([0xa1])]),
      clientLastModifiedMs: null,
    });
    const motion = await ingestMedia({
      familyId,
      createdByUserId: adminUserId,
      kind: "video",
      filename: "photo_2026.mov",
      declaredMime: "video/quicktime",
      buffer: Buffer.concat([fixture("sample.mov"), Buffer.from([0xa1])]),
      clientLastModifiedMs: null,
    });
    if (still.status !== "stored" || motion.status !== "stored") {
      throw new Error("ingest failed");
    }
    const s = await createInboxItemForAsset(familyId, still.asset);
    const m = await createInboxItemForAsset(familyId, motion.asset);
    const merged = await mergeInboxEntries(familyId, [s.id, m.id], {
      title: "动起来的瞬间",
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const detail = (await getMemoryEventDetail(familyId, merged.eventId))!;
    expect(detail.assets).toHaveLength(2);
  });

  it("废弃其中一个条目不影响另一个（绝不自动删除）", async () => {
    const { discardInboxItem } = await import("@/lib/inbox/service");
    const still = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "keep-me.HEIC",
      declaredMime: "image/heic",
      buffer: Buffer.concat([fixture("sample.heic"), Buffer.from([0xb2])]),
      clientLastModifiedMs: null,
    });
    const motion = await ingestMedia({
      familyId,
      createdByUserId: adminUserId,
      kind: "video",
      filename: "drop-me.MOV",
      declaredMime: "video/quicktime",
      buffer: Buffer.concat([fixture("sample.mov"), Buffer.from([0xb3])]),
      clientLastModifiedMs: null,
    });
    if (still.status !== "stored" || motion.status !== "stored") {
      throw new Error("ingest failed");
    }
    const s = await createInboxItemForAsset(familyId, still.asset);
    const m = await createInboxItemForAsset(familyId, motion.asset);

    // 用户明确废弃 MOV 条目
    expect(await discardInboxItem(familyId, m.id)).toBe(true);
    // 另一条目仍在（无时间素材为 needs_review，属预期）
    const entry = await getInboxEntry(familyId, s.id);
    expect(entry?.item.status).toBe("needs_review");
    // 被废弃的 MOV「原件」依然保留（收件箱废弃不删文件）
    const storage = getAssetStorage();
    expect(storage.exists(motion.asset.storageKey)).toBe(true);
  });
});
