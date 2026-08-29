import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-merge-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "merge-setup-token";
process.env.AUTH_SECRET = "merge-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "merge-setup-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { completeOnboarding } = await import("@/lib/family/service");
const { ingestImage, updateAssetCapturedAt } = await import("@/lib/assets/ingest");
const {
  createInboxItemForAsset,
  createTextInboxItem,
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
const OTHER_FAMILY = "fam-merge-other";

const fixtures = path.join(__dirname, "..", "fixtures");
const BASE = readFileSync(path.join(fixtures, "sample-exif.jpg"));

describe("多选合并（#010）", () => {
  it("5 张照片 + 1 段文字 → 1 个 MemoryEvent，5 份素材，条目全部 confirmed", async () => {
    // 4 张照片（各自字节不同）+ 1 张改过时间的照片 + 1 条文字
    const itemIds: string[] = [];
    const assetIds: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const stored = await ingestImage({
        familyId,
        createdByUserId: adminUserId,
        filename: `出游照片${i}.jpg`,
        declaredMime: "image/jpeg",
        buffer: Buffer.concat([BASE, Buffer.from([i])]),
        clientLastModifiedMs: null,
      });
      if (stored.status !== "stored") throw new Error("store failed");
      const item = await createInboxItemForAsset(familyId, stored.asset);
      itemIds.push(item.id);
      assetIds.push(stored.asset.id);
    }
    const fifth = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "更早的照片.jpg",
      declaredMime: "image/jpeg",
      buffer: Buffer.concat([BASE, Buffer.from([0xff])]),
      clientLastModifiedMs: null,
    });
    if (fifth.status !== "stored") throw new Error("store failed");
    const fifthItem = await createInboxItemForAsset(familyId, fifth.asset);
    // 它的 EXIF 也是 8/10 09:30；改成 8/08，验证合并默认取最早
    await updateAssetCapturedAt(
      familyId,
      fifth.asset.id,
      new Date("2026-08-08T02:00:00.000Z"),
    );
    itemIds.push(fifthItem.id);
    assetIds.push(fifth.asset.id);

    const textItem = await createTextInboxItem(familyId, "那天出去玩了一下午。");
    itemIds.push(textItem.id);

    const result = await mergeInboxEntries(familyId, itemIds, {
      title: "八月的一次出游",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const detail = (await getMemoryEventDetail(familyId, result.eventId))!;
    // 5 份素材（文字条目不产生 asset）
    expect(detail.assets).toHaveLength(5);
    for (const id of assetIds) {
      expect(detail.assets.some((a) => a.id === id)).toBe(true);
    }
    // occurredAt = 最早可信 capturedAt（8/08，不是 8/10 也不是导入日 8/29）
    expect(detail.event.occurredAt.toISOString()).toBe("2026-08-08T02:00:00.000Z");
    // 封面默认选图片
    expect(detail.event.coverAssetId).toBeTruthy();
    // 全部条目 confirmed；收件箱清空
    for (const id of itemIds) {
      const entry = await getInboxEntry(familyId, id);
      expect(entry?.item.status).toBe("confirmed");
    }
    expect(await listInbox(familyId)).toHaveLength(0);
  });

  it("至少两项：单项拒绝；空标题拒绝", async () => {
    const stored = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "单张.jpg",
      declaredMime: "image/jpeg",
      buffer: Buffer.concat([BASE, Buffer.from([0xee])]),
      clientLastModifiedMs: null,
    });
    if (stored.status !== "stored") throw new Error("store failed");
    const item = await createInboxItemForAsset(familyId, stored.asset);
    expect(await mergeInboxEntries(familyId, [item.id], { title: "x" })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await mergeInboxEntries(familyId, [item.id, "fake"], { title: "  " })).toEqual({
      ok: false,
      error: "invalid",
    });
    // 不存在的条目
    expect(
      await mergeInboxEntries(familyId, ["nope1", "nope2"], { title: "x" }),
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("家庭隔离：混合他家庭条目时整体拒绝，不产生事件", async () => {
    await db.run(
      sql`INSERT INTO family (id, name, timezone, created_at, updated_at) VALUES (${OTHER_FAMILY}, '别人家', 'Asia/Shanghai', 0, 0)`,
    );
    const a = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "本家1.jpg",
      declaredMime: "image/jpeg",
      buffer: Buffer.concat([BASE, Buffer.from([0xdd])]),
      clientLastModifiedMs: null,
    });
    if (a.status !== "stored") throw new Error("store failed");
    const itemA = await createInboxItemForAsset(familyId, a.asset);

    // 直接在别人家庭下造一个条目
    const b = await ingestImage({
      familyId: OTHER_FAMILY,
      createdByUserId: adminUserId,
      filename: "别家.jpg",
      declaredMime: "image/jpeg",
      buffer: Buffer.concat([BASE, Buffer.from([0xcc])]),
      clientLastModifiedMs: null,
    });
    if (b.status !== "stored") throw new Error("store failed");
    const itemB = await createInboxItemForAsset(OTHER_FAMILY, b.asset);

    const result = await mergeInboxEntries(familyId, [itemA.id, itemB.id], {
      title: "越界合并",
    });
    expect(result).toEqual({ ok: false, error: "not_found" });
    // 本家庭条目未被确认
    const entryA = await getInboxEntry(familyId, itemA.id);
    expect(entryA?.item.status).toBe("new");
  });
});
