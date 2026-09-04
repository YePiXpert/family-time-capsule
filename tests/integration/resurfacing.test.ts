import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { FamilyContext } from "@/lib/family/context";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-resurfacing-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "resurfacing-token";
process.env.AUTH_SECRET = "resurfacing-secret-with-sufficient-entropy";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const { getDb } = await import("@/db");
const { user } = await import("@/db/schema/auth");
const { memoryEvent } = await import("@/db/schema/memory");
const { eq } = await import("drizzle-orm");
const {
  addPerson,
  completeOnboarding,
  getUserBinding,
  listPeople,
} = await import("@/lib/family/service");
const { createTextInboxItem, getInboxEntry } = await import("@/lib/inbox/service");
const {
  confirmInboxEntry,
  listMilestoneEntries,
  updateMemoryEvent,
} = await import("@/lib/memories/service");
const { getResurfacing } = await import("@/lib/memories/resurfacing");
const { createContribution } = await import("@/lib/contributions/service");
const { createContributionRequest } = await import("@/lib/oral-history/service");
const { getPersonProfile } = await import("@/lib/family/profile");

const setup = await performSetup({
  token: "resurfacing-token",
  displayName: "妈妈",
  email: "resurfacing@example.com",
  password: "a-long-enough-resurfacing-password",
});
if (!setup.ok) throw new Error("setup failed");
const admin = getDb().select({ id: user.id }).from(user).get();
if (!admin) throw new Error("admin missing");
const onboarding = await completeOnboarding(admin.id, {
  familyName: "小树家",
  timezone: "Asia/Shanghai",
  childDisplayName: "小树",
  childBirthDate: "2023-01-02",
  selfDisplayName: "妈妈",
  selfRelationToChild: "妈妈",
  selfIsGuardian: true,
});
if (!onboarding.ok) throw new Error("onboarding failed");
const binding = await getUserBinding(admin.id);
if (!binding.familyId || !binding.familyTimezone) throw new Error("binding failed");
const context: FamilyContext = {
  userId: admin.id,
  userName: "妈妈",
  familyId: binding.familyId,
  personId: binding.personId,
  role: binding.role,
  accountEnabled: true,
  isGuardian: binding.isGuardian,
  familyTimezone: binding.familyTimezone,
  childLaterUnlockAge: binding.childLaterUnlockAge ?? 18,
};

async function makeMemory(title: string, occurredAt: string) {
  const item = await createTextInboxItem(context.familyId, `${title}的原始记录`);
  const entry = await getInboxEntry(context.familyId, item.id);
  if (!entry) throw new Error("inbox missing");
  const result = await confirmInboxEntry(context.familyId, entry, {
    title,
    occurredAt: new Date(occurredAt),
  });
  if (!result.ok) throw new Error("confirm failed");
  return result.eventId;
}

describe("重新遇见与人物主页", () => {
  it("按家庭时区返回同日、一个月、百天和一年，并过滤软删除", async () => {
    const edge = await makeMemory("往年同日的凌晨", "2024-09-03T16:30:00.000Z");
    const year = await makeMemory("一年前", "2025-09-04T03:00:00.000Z");
    const month = await makeMemory("一个月前", "2026-08-04T02:00:00.000Z");
    const hundred = await makeMemory("百天前", "2026-05-27T02:00:00.000Z");
    const deleted = await makeMemory("被删除的同日", "2023-09-04T02:00:00.000Z");
    await getDb()
      .update(memoryEvent)
      .set({ deletedAt: new Date("2026-09-01T00:00:00.000Z") })
      .where(eq(memoryEvent.id, deleted));

    const result = await getResurfacing(
      context.familyId,
      "Asia/Shanghai",
      new Date("2026-09-04T08:00:00.000Z"),
    );
    const ids = (kind: string) =>
      result.groups.find((group) => group.kind === kind)?.entries.map((entry) => entry.event.id) ?? [];
    expect(ids("on_this_day")).toEqual(expect.arrayContaining([edge, year]));
    expect(ids("month_ago")).toContain(month);
    expect(ids("hundred_days")).toContain(hundred);
    expect(ids("year_ago")).toContain(year);
    expect(result.groups.flatMap((group) => group.entries).map((entry) => entry.event.id)).not.toContain(deleted);
  });

  it("成长节点仍是 MemoryEvent，支持类型、置顶与修订快照", async () => {
    const eventId = await makeMemory("第一次独立穿鞋", "2026-09-02T02:00:00.000Z");
    const result = await updateMemoryEvent(context.familyId, eventId, admin.id, {
      milestoneType: "first_time",
      isPinned: true,
    });
    expect(result.ok).toBe(true);
    const milestones = await listMilestoneEntries(context.familyId);
    expect(milestones[0]?.event).toMatchObject({
      id: eventId,
      milestoneType: "first_time",
      isPinned: true,
    });
    const invalid = await updateMemoryEvent(context.familyId, eventId, admin.id, {
      milestoneType: "feeding" as never,
    });
    expect(invalid).toEqual({ ok: false, error: "invalid" });
  });

  it("人物主页集中返回共同记忆、可见讲述和关联口述史", async () => {
    const grandmaResult = await addPerson(context.familyId, {
      displayName: "外婆",
      relationToChild: "外婆",
    });
    if (!grandmaResult.ok) throw new Error("person failed");
    const people = await listPeople(context.familyId);
    const child = people.find((person) => person.isChild)!;
    const eventId = await makeMemory("外婆教我们包饺子", "2026-08-20T02:00:00.000Z");
    await updateMemoryEvent(context.familyId, eventId, admin.id, {
      participantPersonIds: [grandmaResult.personId],
    });
    const contribution = await createContribution(context.familyId, {
      memoryEventId: eventId,
      authorPersonId: grandmaResult.personId,
      recordedByUserId: admin.id,
      rawText: "小时候过年，饺子要包到午夜。",
      visibility: "family",
    });
    expect(contribution.ok).toBe(true);
    const request = createContributionRequest(context, {
      recipientLabel: "外婆",
      recipientPersonId: grandmaResult.personId,
      promptText: "小时候过年最期待什么？",
    });
    expect(request.ok).toBe(true);

    const profile = await getPersonProfile(context, grandmaResult.personId);
    expect(profile?.person.displayName).toBe("外婆");
    expect(profile?.participatingMemories.map((entry) => entry.event.id)).toContain(eventId);
    expect(profile?.sharedWithChildren.map((entry) => entry.event.childPersonId)).toContain(child.id);
    expect(profile?.narratives[0]).toMatchObject({
      memoryEventId: eventId,
      text: "小时候过年，饺子要包到午夜。",
    });
    expect(profile?.oralHistoryRequests[0]).toMatchObject({
      recipientPersonId: grandmaResult.personId,
      promptText: "小时候过年最期待什么？",
    });
    expect(await getPersonProfile(context, "person-from-another-family")).toBeNull();
  });
});
