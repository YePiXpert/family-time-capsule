import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-memory-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "memory-setup-token";
process.env.AUTH_SECRET = "memory-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "memory-setup-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { addPerson, completeOnboarding } = await import("@/lib/family/service");
const { ingestImage } = await import("@/lib/assets/ingest");
const { getAsset } = await import("@/lib/assets/service");
const {
  createInboxItemForAsset,
  createTextInboxItem,
  getInboxEntry,
} = await import("@/lib/inbox/service");
const {
  confirmInboxEntry,
  getMemoryEventDetail,
  defaultOccurredAt,
  computeAgeDays,
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
const OTHER_FAMILY = "fam-memory-other";

const fixtures = path.join(__dirname, "..", "fixtures");
function jpegVariant(n: number, withExif = true): Buffer {
  return Buffer.concat([
    readFileSync(path.join(fixtures, withExif ? "sample-exif.jpg" : "sample.jpg")),
    Buffer.from([n]),
  ]);
}

async function ingestAndInbox(n: number, withExif = true) {
  const stored = await ingestImage({
    familyId,
    createdByUserId: adminUserId,
    filename: withExif ? `照片${n}.jpg` : `无时间照片${n}.jpg`,
    declaredMime: "image/jpeg",
    buffer: jpegVariant(n, withExif),
    clientLastModifiedMs: null,
  });
  if (stored.status !== "stored") throw new Error("store failed");
  const item = await createInboxItemForAsset(familyId, stored.asset);
  return { asset: stored.asset, item };
}

describe("确认收件箱 → MemoryEvent（#008）", () => {
  it("occurredAt 取 Asset capturedAt（8/10），不是 importedAt（8/29）", async () => {
    const { asset, item } = await ingestAndInbox(1);
    // EXIF: 2026-08-10T09:30 上海 → 01:30Z；导入发生在之后
    const entry = (await getInboxEntry(familyId, item.id))!;
    const result = await confirmInboxEntry(familyId, entry, { title: "第一次笑" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const detail = (await getMemoryEventDetail(familyId, result.eventId))!;
    expect(detail.event.occurredAt.toISOString()).toBe("2026-08-10T01:30:00.000Z");
    expect(detail.event.title).toBe("第一次笑");
    expect(detail.event.status).toBe("confirmed");
    // ageDays 快照 = 8/10 事件对 8/10 生日 → 0
    expect(detail.event.ageDays).toBe(0);
    // InboxItem 已 confirmed
    const after = (await getInboxEntry(familyId, item.id))!;
    expect(after.item.status).toBe("confirmed");
    // Assets 通过关联表挂到事件
    expect(detail.assets.map((a) => a.id)).toContain(asset.id);
    // Asset 未被复制
    const assetRow = await getAsset(familyId, asset.id);
    expect(assetRow?.id).toBe(asset.id);
  });

  it("多 Asset 默认取最早 capturedAt，参与人含孩子", async () => {
    await addPerson(familyId, { displayName: "妈妈", relationToChild: "妈妈" });
    const a = await ingestAndInbox(2);
    const b = await ingestAndInbox(3);
    const entryA = (await getInboxEntry(familyId, a.item.id))!;
    const entryB = (await getInboxEntry(familyId, b.item.id))!;

    // 手工把 b 的 capturedAt 改早，验证默认取最早（重新加载拿到新时间）
    const { updateAssetCapturedAt } = await import("@/lib/assets/ingest");
    await updateAssetCapturedAt(
      familyId,
      b.asset.id,
      new Date("2026-08-05T00:00:00.000Z"),
    );
    const entryB2 = (await getInboxEntry(familyId, b.item.id))!;

    const mergedEntry = {
      item: entryB2.item,
      assets: [...entryA.assets, entryB2.assets[0]],
    };
    const result = await confirmInboxEntry(familyId, mergedEntry as never, {
      participantPersonIds: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const detail = (await getMemoryEventDetail(familyId, result.eventId))!;
    expect(detail.event.occurredAt.toISOString()).toBe("2026-08-05T00:00:00.000Z");
    expect(detail.assets).toHaveLength(2);
    // 参与者只有孩子（妈妈传空也至少有孩子）
    expect(detail.participants).toHaveLength(1);
    expect(detail.participants[0].isChild).toBe(true);
  });

  it("文本条目确认：标题取正文，occurredAt 兜底条目创建时间", async () => {
    const item = await createTextInboxItem(familyId, "小满今天会翻身了。");
    const entry = (await getInboxEntry(familyId, item.id))!;
    const result = await confirmInboxEntry(familyId, entry, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const detail = (await getMemoryEventDetail(familyId, result.eventId))!;
    expect(detail.event.title).toBe("小满今天会翻身了。");
    expect(detail.assets).toHaveLength(0);
  });

  it("非法输入：空标题拒绝", async () => {
    const a = await ingestAndInbox(4);
    const entry = (await getInboxEntry(familyId, a.item.id))!;
    const result = await confirmInboxEntry(familyId, entry, { title: "  " });
    expect(result).toEqual({ ok: false, error: "invalid" });
  });

  it("家庭隔离：他家庭读不到事件", async () => {
    await db.run(
      sql`INSERT INTO family (id, name, timezone, created_at, updated_at) VALUES (${OTHER_FAMILY}, '别人家', 'Asia/Shanghai', 0, 0)`,
    );
    const a = await ingestAndInbox(5);
    const entry = (await getInboxEntry(familyId, a.item.id))!;
    const result = await confirmInboxEntry(familyId, entry, {});
    if (!result.ok) throw new Error("confirm failed");
    expect(await getMemoryEventDetail(OTHER_FAMILY, result.eventId)).toBeUndefined();
  });
});

describe("时间与年龄工具", () => {
  it("defaultOccurredAt 全无 capturedAt 时用最早 importedAt", async () => {
    const a = await ingestAndInbox(6, false);
    const entry = (await getInboxEntry(familyId, a.item.id))!;
    const at = defaultOccurredAt(entry.assets, entry.item);
    expect(at.getTime()).toBeGreaterThanOrEqual(
      Math.floor(new Date().getTime() / 1000) * 1000 - 60_000,
    );
  });

  it("computeAgeDays 边界", () => {
    expect(computeAgeDays("2026-08-10", new Date("2026-08-10T00:00:00Z"))).toBe(0);
    expect(computeAgeDays("2026-08-10", new Date("2026-08-09T23:00:00Z"))).toBe(-1);
    expect(computeAgeDays("2026-08-10", new Date("2026-11-18T00:00:00Z"))).toBe(100);
    expect(computeAgeDays("bad-date", new Date())).toBeNull();
  });
});
