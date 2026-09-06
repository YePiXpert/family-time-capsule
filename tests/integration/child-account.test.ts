import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

/**
 * M2-d 孩子本人账号绑定（ID-16/SEC-5）：
 * - 孩子绑定的邀请只允许 viewer/contributor，且必须由在册监护人发起；
 * - 监护授权留痕（person.child_account_invited）；
 * - 角色变更不能把孩子账号提为 admin/editor；
 * - 绑定不解锁 child_later（不按年龄/开通自动解锁）。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-child-bind-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "child-bind-setup-token";
process.env.AUTH_SECRET = "child-bind-test-secret-0123456789";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { auditLog } = await import("@/db/schema/audit");
const { person, family } = await import("@/db/schema/family");
const { user: userTable } = await import("@/db/schema/auth");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding } = await import("@/lib/family/service");
const { createFamilyInvitation } = await import("@/lib/invitations/service");
const { changeFamilyAccountRole } = await import("@/lib/accounts/service");

const PASSWORD = "child-bind-password-long";
const setup = await performSetup({
  token: "child-bind-setup-token",
  displayName: "妈妈",
  email: "owner@example.com",
  password: PASSWORD,
});
if (!setup.ok) throw new Error(`setup failed: ${setup.error}`);
const ownerUser = getDb()
  .select({ id: userTable.id })
  .from(userTable)
  .where(eq(userTable.email, "owner@example.com"))
  .all()[0];
if (!ownerUser) throw new Error("owner user missing");
const onboarding = await completeOnboarding(ownerUser.id, {
  familyName: "孩子绑定家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2015-05-01",
  selfDisplayName: "妈妈",
  selfRelationToChild: "妈妈",
  selfIsGuardian: true,
});
if (!onboarding.ok) throw new Error(`onboarding failed: ${onboarding.error}`);
const familyId = onboarding.familyId;
// onboarding 勾选监护人 → owner 的 person.isGuardian = true
const childPerson = getDb()
  .select()
  .from(person)
  .where(eq(person.familyId, familyId))
  .all()
  .find((row) => row.isChild);
if (!childPerson) throw new Error("child person missing");
if (!getDb().select().from(person).all().some((row) => row.isGuardian)) {
  throw new Error("onboarding guardian flag missing");
}

function contextFor(userId: string) {
  return {
    userId,
    userName: "x",
    familyId,
    personId: null,
    role: "owner" as const,
    accountEnabled: true as const,
    isGuardian: true,
    familyTimezone: "Asia/Shanghai",
    childLaterUnlockAge: 18,
  };
}

describe("孩子本人账号绑定（ID-16）", () => {
  it("孩子绑定 + 管理角色被拒绝", async () => {
    const result = await createFamilyInvitation({
      familyId,
      actorUserId: ownerUser.id,
      role: "admin",
      personId: childPerson.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect(result).toMatchObject({ ok: false, error: "child_role_not_allowed" });
    const editor = await createFamilyInvitation({
      familyId,
      actorUserId: ownerUser.id,
      role: "editor",
      personId: childPerson.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect(editor).toMatchObject({ ok: false, error: "child_role_not_allowed" });
  });

  it("非监护人发起孩子绑定被拒绝；监护人发起 viewer 邀请成功且留痕", async () => {
    // 造一个非监护人的 admin
    const adminId = `admin-${randomUUID()}`;
    const now = new Date();
    getDb()
      .insert(userTable)
      .values({
        id: adminId,
        name: "管理员乙",
        email: "admin2@example.com",
        emailVerified: true,
        role: "admin",
        familyId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const denied = await createFamilyInvitation({
      familyId,
      actorUserId: adminId,
      role: "viewer",
      personId: childPerson.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect(denied).toMatchObject({ ok: false, error: "guardian_consent_required" });

    const allowed = await createFamilyInvitation({
      familyId,
      actorUserId: ownerUser.id,
      role: "viewer",
      personId: childPerson.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect(allowed.ok).toBe(true);
    const audited = getDb()
      .select({ kind: auditLog.kind })
      .from(auditLog)
      .where(eq(auditLog.kind, "person.child_account_invited"))
      .all();
    expect(audited.length).toBe(1);
    // 绑定不触碰 child_later 解锁状态
    const childRow = getDb()
      .select({ unlockedAt: person.childLaterUnlockedAt })
      .from(person)
      .where(eq(person.id, childPerson.id))
      .all()[0]!;
    expect(childRow.unlockedAt).toBeNull();
  });

  it("孩子账号日后不能被提为 admin/editor", async () => {
    const childUserId = `child-${randomUUID()}`;
    const now = new Date();
    getDb()
      .insert(userTable)
      .values({
        id: childUserId,
        name: "小满",
        email: `child-${childUserId}@example.com`,
        emailVerified: true,
        role: "viewer",
        familyId,
        personId: childPerson.id,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    expect(
      changeFamilyAccountRole(contextFor(ownerUser.id), childUserId, "admin"),
    ).toMatchObject({ ok: false, error: "child_role_not_allowed" });
    expect(
      changeFamilyAccountRole(contextFor(ownerUser.id), childUserId, "editor"),
    ).toMatchObject({ ok: false, error: "child_role_not_allowed" });
    // viewer → contributor 仍是允许的家人参与角色
    expect(
      changeFamilyAccountRole(contextFor(ownerUser.id), childUserId, "contributor"),
    ).toMatchObject({ ok: true });
  });
});
