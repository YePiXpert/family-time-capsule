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

describe("minimal family summary", () => {
  it("returns only family, capture capability and actionable inbox count", async () => {
    expect(await getHomeDashboard(context)).toEqual({family:{name:"小满家",timezone:"Asia/Shanghai"},capabilities:{canCapture:true},inbox:{count:0},pendingImports:[]});
  });
  it("clears the pending count after confirming a record", async () => {
    const item = await createTextInboxItem(context.familyId,"第一次记录");
    expect((await getHomeDashboard(context)).inbox.count).toBe(1);
    const entry = await getInboxEntry(context.familyId,item.id);
    const result = await confirmInboxEntry(context.familyId,entry!,{title:"第一次记录",occurredAt:new Date("2026-09-04T08:00:00Z")});
    expect(result.ok).toBe(true);
    expect((await getHomeDashboard(context)).inbox.count).toBe(0);
  });
});

it("shows only this member's actionable imports, excluding completed, cancelled and active transfers", async () => {
  const { randomUUID } = await import("node:crypto");
  const { importSession } = await import("@/db/schema/import");
  const otherUser = randomUUID();
  getDb().insert(user).values({ id: otherUser, familyId: context.familyId, name: "另一位家人", email: `${otherUser}@fixture.invalid`, role: "editor" }).run();
  const ids: string[] = [];
  for (const [status, totalCount, failedCount, owner] of [
    ["collecting", 2, 0, admin.id], ["reviewing", 2, 1, admin.id],
    ["collecting", 0, 0, admin.id], ["uploading", 2, 0, admin.id],
    ["completed", 2, 0, admin.id], ["cancelled", 2, 1, admin.id],
    ["collecting", 2, 0, otherUser],
  ] as const) {
    const id = randomUUID(); ids.push(id);
    getDb().insert(importSession).values({ id, familyId: context.familyId, source: "web", status, totalCount, failedCount, completedCount: status === "completed" ? totalCount : 0, createdByUserId: owner }).run();
  }
  expect((await getHomeDashboard(context)).pendingImports.map(row => row.id).sort()).toEqual(ids.slice(0, 2).sort());
});
