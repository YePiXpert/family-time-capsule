import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { FamilyContext } from "@/lib/family/context";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-home-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "home-setup-token";
process.env.AUTH_SECRET = "home-test-secret-with-sufficient-entropy";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const { getDb } = await import("@/db");
const { user } = await import("@/db/schema/auth");
const { completeOnboarding, getUserBinding } = await import(
  "@/lib/family/service"
);
const { createTextInboxItem, getInboxEntry } = await import(
  "@/lib/inbox/service"
);
const { confirmInboxEntry } = await import("@/lib/memories/service");
const { getHomeDashboard } = await import("@/lib/home/service");

const setup = await performSetup({
  token: "home-setup-token",
  displayName: "妈妈",
  email: "home@example.com",
  password: "a-long-enough-home-password",
});
if (!setup.ok) throw new Error("setup failed");
const admin = getDb().select({ id: user.id }).from(user).get();
if (!admin) throw new Error("admin missing");
const onboarding = await completeOnboarding(admin.id, {
  familyName: "小满家",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2024-02-03",
  selfDisplayName: "妈妈",
  selfRelationToChild: "妈妈",
  selfIsGuardian: true,
});
if (!onboarding.ok) throw new Error("onboarding failed");
const binding = await getUserBinding(admin.id);
if (!binding.familyId || !binding.familyTimezone) {
  throw new Error("binding incomplete");
}
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

describe("real family dashboard", () => {
  it("returns a useful first-use state from real family data", async () => {
    const dashboard = await getHomeDashboard(
      context,
      new Date("2026-09-04T08:00:00.000Z"),
    );
    expect(dashboard.family.name).toBe("小满家");
    expect(dashboard.child).toMatchObject({ displayName: "小满" });
    expect(dashboard.child?.currentAgeLabel).toBeTruthy();
    expect(dashboard.inbox).toEqual({ count: 0, previews: [] });
    expect(dashboard.recentMemories).toEqual([]);
    expect(dashboard.familyPrompt.text.length).toBeGreaterThan(5);
    expect(dashboard.isFirstUse).toBe(true);
  });

  it("shows bounded inbox previews and then a confirmed memory", async () => {
    const item = await createTextInboxItem(
      context.familyId,
      "第一次从真实数据首页看到这句话。",
    );
    const withInbox = await getHomeDashboard(context);
    expect(withInbox.inbox.count).toBe(1);
    expect(withInbox.inbox.previews).toEqual([
      expect.objectContaining({ id: item.id, title: "第一次从真实数据首页看到这句话。" }),
    ]);
    expect(withInbox.isFirstUse).toBe(false);

    const entry = await getInboxEntry(context.familyId, item.id);
    if (!entry) throw new Error("inbox entry missing");
    const confirmed = await confirmInboxEntry(context.familyId, entry, {
      title: "去年今天的一句话",
      occurredAt: new Date("2025-09-04T08:00:00.000Z"),
    });
    expect(confirmed.ok).toBe(true);

    const archived = await getHomeDashboard(
      context,
      new Date("2026-09-04T08:00:00.000Z"),
    );
    expect(archived.inbox.count).toBe(0);
    expect(archived.recentMemories[0]).toMatchObject({
      title: "去年今天的一句话",
      assetCount: 0,
    });
    expect(archived.onThisDay[0]?.id).toBe(confirmed.ok ? confirmed.eventId : "");
  });
});
