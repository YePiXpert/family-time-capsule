import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 正式 1.0 §8 FIND-9：回顾屏蔽。
 * T13：屏蔽影响自动推荐，不删除来源、不改变主动搜索；是用户自己的偏好。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-resurface-block-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "resurface-token";
process.env.AUTH_SECRET = "resurface-block-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "resurface-token", displayName: "妈妈", email: "resurface@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { completeOnboarding, getUserBinding, addPerson } = await import("@/lib/family/service");
const { saveDraft, publishDraft } = await import("@/lib/drafts/service");
const { emptyDraftContent } = await import("@/lib/drafts/model");

const db = getDb();
const userA = (await db.select({ id: userTable.id }).from(userTable))[0].id;
const onboarding = await completeOnboarding(userA, {
  familyName: "回顾屏蔽家庭", timezone: "Asia/Shanghai",
  childDisplayName: "小满", childBirthDate: "2026-08-10",
  selfDisplayName: "妈妈", selfRelationToChild: "妈妈",
});
if (!onboarding.ok) throw new Error("onboarding failed");
const familyId = onboarding.familyId;
db.insert(userTable).values({
  id: "user-b-resurface", name: "爸爸B", email: "b@resurface.example.com", emailVerified: true,
  role: "editor", familyId, createdAt: new Date(), updatedAt: new Date(),
}).run();

async function contextFor(userId: string) {
  const binding = await getUserBinding(userId);
  if (!binding.familyTimezone || binding.childLaterUnlockAge === null) throw new Error("binding");
  return {
    userId, userName: userId, familyId: binding.familyId, personId: binding.personId,
    role: binding.role, accountEnabled: binding.accountEnabled, isGuardian: binding.isGuardian,
    familyTimezone: binding.familyTimezone, childLaterUnlockAge: binding.childLaterUnlockAge,
  } as import("@/lib/family/context").FamilyContext;
}
const contextA = await contextFor(userA);
const contextB = await contextFor("user-b-resurface");

const { getResurfacing } = await import("@/lib/memories/resurfacing");
const { getTimelinePage } = await import("@/lib/memories/service");
const { searchFamily } = await import("@/lib/search/service");
const { addResurfacingBlock, listResurfacingPreferences, removeResurfacingBlock } = await import("@/lib/memories/resurfacing-preferences");

let serial = 0;
async function publishAt(title: string, text: string, isoDate: string, participantIds: string[] = []) {
  const id = `resurface-draft-${++serial}`;
  saveDraft(contextA, id, 0, `mut-${id}`, {
    ...emptyDraftContent(),
    title, text,
    occurredAt: new Date(isoDate).toISOString(),
    occurredAtPrecision: "date_only",
    participantIds,
  });
  const published = publishDraft(contextA, id, 1);
  if (!published.memoryEventId) throw new Error("publish failed");
  return published.memoryEventId;
}

function shiftDays(base: Date, days: number): string {
  return new Date(base.getTime() + days * 86_400_000).toISOString();
}

const NOW = new Date();
// 用真实的回顾分组目标日（家庭本地日期）定位种子事件，避免时区偏一天。
const { zonedWallTimeToUtc } = await import("@/lib/metadata/time");
const probe = await getResurfacing(familyId, "Asia/Shanghai", NOW, 8, contextA);
const targetOf = (kind: string) => probe.groups.find((group) => group.kind === kind)?.targetDate;
const monthTarget = targetOf("month_ago");
const hundredTarget = targetOf("hundred_days");
if (!monthTarget || !hundredTarget) throw new Error("probe targets missing");
const atLocalNoon = (localDate: string) => zonedWallTimeToUtc(`${localDate}T12:00:00`, "Asia/Shanghai").toISOString();
const monthAgoEvent = await publishAt("一个月前的家宴", "全家一起吃了饺子", atLocalNoon(monthTarget));
const hundredDaysAgoEvent = await publishAt("百天前的第一次笑", "她对着摇铃笑出了声", atLocalNoon(hundredTarget));
const grandpa = await addPerson(familyId, { displayName: "屏蔽外公", isChild: false });
if (!grandpa.ok) throw new Error("person failed");
const withGrandpaEvent = await publishAt("外公来家里", "外公抱着她在阳台看鸟", atLocalNoon(hundredTarget), [grandpa.personId]);
void shiftDays;

describe("§8 FIND-9 回顾屏蔽", () => {
  it("默认全部可见；屏蔽事件只影响该用户的自动推荐", async () => {
    const base = await getResurfacing(familyId, "Asia/Shanghai", NOW, 8, contextA);
    const allIds = base.groups.flatMap((group) => group.entries.map((entry) => entry.event.id));
    expect(allIds).toContain(monthAgoEvent);

    const block = addResurfacingBlock(contextA, { kind: "event", eventId: monthAgoEvent });
    expect(block.ok).toBe(true);
    const after = await getResurfacing(familyId, "Asia/Shanghai", NOW, 8, contextA);
    const afterIds = after.groups.flatMap((group) => group.entries.map((entry) => entry.event.id));
    expect(afterIds).not.toContain(monthAgoEvent);
    // 来源未删除：时间轴与搜索照常
    expect((await getTimelinePage(contextA, { limit: 50 })).entries.map((e) => e.event.id)).toContain(monthAgoEvent);
    expect(searchFamily(contextA, { q: "饺子" }).events.map((e) => e.id)).toContain(monthAgoEvent);
    // 其他用户不受影响
    const asB = await getResurfacing(familyId, "Asia/Shanghai", NOW, 8, contextB);
    expect(asB.groups.flatMap((g) => g.entries.map((e) => e.event.id))).toContain(monthAgoEvent);
  });

  it("屏蔽人物：该人物参与的事件从自动回顾消失，其余保留", async () => {
    const block = addResurfacingBlock(contextA, { kind: "person", personId: grandpa.personId });
    expect(block.ok).toBe(true);
    const after = await getResurfacing(familyId, "Asia/Shanghai", NOW, 8, contextA);
    const ids = after.groups.flatMap((g) => g.entries.map((e) => e.event.id));
    expect(ids).not.toContain(withGrandpaEvent);
    expect(ids).toContain(hundredDaysAgoEvent);
    // 主动搜索不受影响
    expect(searchFamily(contextA, { q: "看鸟" }).events.map((e) => e.id)).toContain(withGrandpaEvent);
  });

  it("屏蔽日期范围与暂停回顾；取消屏蔽恢复", async () => {
    // 覆盖百天前目标日的范围（按家庭本地日期）
    const rangeFrom = shiftDays(new Date(`${hundredTarget}T00:00:00Z`), -5).slice(0, 10);
    const rangeTo = shiftDays(new Date(`${hundredTarget}T00:00:00Z`), 5).slice(0, 10);
    const rangeBlock = addResurfacingBlock(contextA, { kind: "date_range", dateFrom: rangeFrom, dateTo: rangeTo });
    expect(rangeBlock.ok).toBe(true);
    const afterRange = await getResurfacing(familyId, "Asia/Shanghai", NOW, 8, contextA);
    const rangeIds = afterRange.groups.flatMap((g) => g.entries.map((e) => e.event.id));
    expect(rangeIds).not.toContain(hundredDaysAgoEvent);
    expect(rangeIds).not.toContain(withGrandpaEvent);
    expect(rangeIds).not.toContain(monthAgoEvent); // 事件级屏蔽仍在

    // 暂停：所有分组为空，但 hasHistory 如实保留
    addResurfacingBlock(contextA, { kind: "pause" });
    const paused = await getResurfacing(familyId, "Asia/Shanghai", NOW, 8, contextA);
    expect(paused.groups.flatMap((g) => g.entries)).toHaveLength(0);
    expect(paused.hasHistory).toBe(true);

    // 全部取消后恢复
    for (const preference of listResurfacingPreferences(contextA)) {
      expect(removeResurfacingBlock(contextA, preference.id)).toBe(true);
    }
    const restored = await getResurfacing(familyId, "Asia/Shanghai", NOW, 8, contextA);
    const restoredIds = restored.groups.flatMap((g) => g.entries.map((e) => e.event.id));
    expect(restoredIds).toContain(monthAgoEvent);
    expect(restoredIds).toContain(hundredDaysAgoEvent);
    expect(restoredIds).toContain(withGrandpaEvent);
  });

  it("非法目标与跨家庭/跨用户被拒绝", async () => {
    expect(addResurfacingBlock(contextA, { kind: "event", eventId: "not-an-event" }).ok).toBe(false);
    expect(addResurfacingBlock(contextA, { kind: "date_range", dateFrom: "2026-13-01", dateTo: "2026-13-02" }).ok).toBe(false);
    // A 的偏好不能被 B 删除
    const own = addResurfacingBlock(contextA, { kind: "event", eventId: monthAgoEvent });
    if (!own.ok) throw new Error("block failed");
    expect(removeResurfacingBlock(contextB, own.preference.id)).toBe(false);
    expect(removeResurfacingBlock(contextA, own.preference.id)).toBe(true);
  });
});
