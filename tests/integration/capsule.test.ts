import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-capsule-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "capsule-setup-token";
process.env.AUTH_SECRET = "capsule-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "capsule-setup-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { completeOnboarding, listPeople } = await import("@/lib/family/service");
const { ingestImage } = await import("@/lib/assets/ingest");
const { createInboxItemForAsset, getInboxEntry } = await import("@/lib/inbox/service");
const { confirmInboxEntry } = await import("@/lib/memories/service");
const { createContribution } = await import("@/lib/contributions/service");
const {
  createCapsule,
  sealCapsule,
  openCapsule,
  addCapsuleEvent,
  addCapsuleAsset,
  addCapsuleContribution,
  getCapsuleDetail,
  listCapsules,
  isCapsuleUnlocked,
} = await import("@/lib/capsules/service");

const db = getDb();
const adminUserId = (await db.select({ id: userTable.id }).from(userTable))[0].id;
const onboarding = await completeOnboarding(adminUserId, {
  familyName: "我们一家",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2026-08-10", // 孩子 2026-08-10 出生
  selfDisplayName: "爸爸",
  selfRelationToChild: "爸爸",
});
if (!onboarding.ok) throw new Error("onboarding failed");
const familyId = onboarding.familyId;
const TZ = "Asia/Shanghai";
const CHILD_BIRTH = "2026-08-10";
const OTHER_FAMILY = "fam-capsule-other";
const NOW = new Date("2026-08-29T04:00:00.000Z"); // 8/29 中午

const fixtures = path.join(__dirname, "..", "fixtures");

async function makeEvent(n: number): Promise<{ eventId: string; assetId: string }> {
  const stored = await ingestImage({
    familyId,
    createdByUserId: adminUserId,
    filename: `事件${n}.jpg`,
    declaredMime: "image/jpeg",
    buffer: Buffer.concat([
      readFileSync(path.join(fixtures, "sample-exif.jpg")),
      Buffer.from([n]),
    ]),
    clientLastModifiedMs: null,
  });
  if (stored.status !== "stored") throw new Error("store failed");
  const item = await createInboxItemForAsset(familyId, stored.asset);
  const entry = (await getInboxEntry(familyId, item.id))!;
  const result = await confirmInboxEntry(familyId, entry, { title: `事件${n}` });
  if (!result.ok) throw new Error("confirm failed");
  return { eventId: result.eventId, assetId: stored.asset.id };
}

describe("解锁判定", () => {
  it("date 型：家庭时区当日零点起解锁", () => {
    const capsule = { unlockType: "date", unlockValue: "2026-08-29", status: "sealed" };
    // 8/28 深夜 UTC（= 8/29 早上上海）还没到上海 8/29 零点？
    // 上海 8/29 零点 = 8/28 16:00 UTC。NOW=8/29 04:00 UTC 已过 → 解锁
    expect(isCapsuleUnlocked(capsule, CHILD_BIRTH, TZ, NOW)).toBe(true);
    // 8/30 的胶囊在 8/29 未解锁
    const future = { unlockType: "date", unlockValue: "2026-08-30", status: "sealed" };
    expect(isCapsuleUnlocked(future, CHILD_BIRTH, TZ, NOW)).toBe(false);
    // 边界：上海 8/29 零点（= UTC 8/28T16:00）前一秒未解锁
    expect(
      isCapsuleUnlocked(capsule, CHILD_BIRTH, TZ, new Date("2026-08-28T15:59:59Z")),
    ).toBe(false);
    expect(
      isCapsuleUnlocked(capsule, CHILD_BIRTH, TZ, new Date("2026-08-28T16:00:00Z")),
    ).toBe(true);
  });

  it("age 型：孩子满 N 周岁解锁", () => {
    const capsule = { unlockType: "age", unlockValue: "1", status: "sealed" };
    // 2027-08-10 满一岁
    expect(isCapsuleUnlocked(capsule, CHILD_BIRTH, TZ, new Date("2027-08-09T12:00:00Z"))).toBe(false);
    expect(isCapsuleUnlocked(capsule, CHILD_BIRTH, TZ, new Date("2027-08-10T12:00:00Z"))).toBe(true);
    const age18 = { unlockType: "age", unlockValue: "18", status: "sealed" };
    expect(isCapsuleUnlocked(age18, CHILD_BIRTH, TZ, NOW)).toBe(false);
  });

  it("draft / opened 状态语义", () => {
    const draft = { unlockType: "date", unlockValue: "2000-01-01", status: "draft" };
    expect(isCapsuleUnlocked(draft, CHILD_BIRTH, TZ, NOW)).toBe(false);
    const opened = { unlockType: "date", unlockValue: "2999-01-01", status: "opened" };
    expect(isCapsuleUnlocked(opened, CHILD_BIRTH, TZ, NOW)).toBe(true);
  });
});

describe("胶囊工作流（#013）", () => {
  it("创建 → 放入事件/素材/讲述 → 封存 → 未到时间隐藏 → includeLocked 完整", async () => {
    const { eventId, assetId } = await makeEvent(1);
    const people = await listPeople(familyId);
    const dad = people.find((p) => p.relationToChild === "爸爸")!;
    const contrib = await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: dad.id,
      recordedByUserId: adminUserId,
      rawText: "写给一岁的你：愿你被很多人爱着。",
      visibility: "child_later",
    });
    if (!contrib.ok) throw new Error("contribution failed");

    const created = await createCapsule(familyId, {
      title: "写给一岁的你",
      unlockType: "date",
      unlockValue: "2027-08-10", // 明年才开
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(await addCapsuleEvent(familyId, created.capsuleId, eventId)).toBe(true);
    expect(await addCapsuleAsset(familyId, created.capsuleId, assetId)).toBe(true);
    expect(
      await addCapsuleContribution(familyId, created.capsuleId, contrib.contributionId),
    ).toBe(true);

    // draft 状态内容可见
    const draft = (await getCapsuleDetail(familyId, created.capsuleId, CHILD_BIRTH, TZ))!;
    expect(draft.events).toHaveLength(1);
    expect(draft.assets).toHaveLength(1);
    expect(draft.contributions).toHaveLength(1);

    // 封存
    const sealed = await sealCapsule(familyId, created.capsuleId);
    expect(sealed?.status).toBe("sealed");
    expect(sealed?.sealedAt).toBeTruthy();

    // 未到时间：普通视图隐藏正文
    const lockedView = (await getCapsuleDetail(familyId, created.capsuleId, CHILD_BIRTH, TZ))!;
    expect(lockedView.events).toHaveLength(0);
    expect(lockedView.assets).toHaveLength(0);
    expect(lockedView.contributions).toHaveLength(0);
    expect(lockedView.capsule.title).toBe("写给一岁的你"); // 元信息仍可见

    // 导出/备份视角（includeLocked）：完整包含——封存不是物理加密
    const exportView = (await getCapsuleDetail(familyId, created.capsuleId, CHILD_BIRTH, TZ, {
      includeLocked: true,
    }))!;
    expect(exportView.events).toHaveLength(1);
    expect(exportView.assets).toHaveLength(1);
    expect(exportView.contributions).toHaveLength(1);

    // 未到时间不能开启；封存后不能再加内容
    const cannotOpen = await openCapsule(familyId, created.capsuleId, CHILD_BIRTH, TZ);
    expect(cannotOpen).toEqual({ ok: false, error: "not_unlocked" });
    expect(await addCapsuleEvent(familyId, created.capsuleId, eventId)).toBe(false);
  });

  it("date 解锁：到期后可开启，内容重现", async () => {
    const { eventId } = await makeEvent(2);
    const created = await createCapsule(familyId, {
      title: "百天礼物",
      unlockType: "date",
      unlockValue: "2026-08-20", // 已过
    });
    if (!created.ok) throw new Error("create failed");
    await addCapsuleEvent(familyId, created.capsuleId, eventId);
    await sealCapsule(familyId, created.capsuleId);

    // 列表显示已解锁
    const list = await listCapsules(familyId, CHILD_BIRTH, TZ);
    const mine = list.find((c) => c.id === created.capsuleId)!;
    expect(mine.unlocked).toBe(true);

    const opened = await openCapsule(familyId, created.capsuleId, CHILD_BIRTH, TZ);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.row.status).toBe("opened");
    expect(opened.row.openedAt).toBeTruthy();

    const detail = (await getCapsuleDetail(familyId, created.capsuleId, CHILD_BIRTH, TZ))!;
    expect(detail.events).toHaveLength(1);
  });

  it("age 解锁 + 非法输入 + 隔离", async () => {
    const bad1 = await createCapsule(familyId, {
      title: "x",
      unlockType: "date",
      unlockValue: "2026-02-30",
    });
    expect(bad1).toEqual({ ok: false, error: "invalid" });
    const bad2 = await createCapsule(familyId, {
      title: "x",
      unlockType: "age",
      unlockValue: "0",
    });
    expect(bad2).toEqual({ ok: false, error: "invalid" });

    await db.run(
      sql`INSERT INTO family (id, name, timezone, created_at, updated_at) VALUES (${OTHER_FAMILY}, '别人家', 'Asia/Shanghai', 0, 0)`,
    );
    expect(
      await getCapsuleDetail(OTHER_FAMILY, "whatever", CHILD_BIRTH, TZ),
    ).toBeUndefined();
    const list = await listCapsules(OTHER_FAMILY, CHILD_BIRTH, TZ);
    expect(list).toHaveLength(0);
  });
});
