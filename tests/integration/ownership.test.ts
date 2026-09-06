import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

/**
 * M2 身份模型专项：owner 角色、所有权移交、活动会话管理。
 * 独立数据库（不与其他账号测试共享状态——那边的自降级用例会把首个
 * 管理员变回 admin，这里的 owner 断言必须从干净状态出发）。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-ownership-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "ownership-setup-token";
process.env.AUTH_SECRET = "ownership-test-secret-0123456789";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { auditLog } = await import("@/db/schema/audit");
const { account, session, user: userTable } = await import("@/db/schema/auth");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, getUserBinding } = await import(
  "@/lib/family/service"
);
const {
  changeFamilyAccountRole,
  disableFamilyAccount,
  listOwnSessions,
  revokeOtherSessions,
  transferOwnership,
  verifyCurrentPassword,
} = await import("@/lib/accounts/service");
const { createFamilyInvitation } = await import("@/lib/invitations/service");

const OWNER_PASSWORD = "ownership-password-long-enough";
const ADMIN_PASSWORD = "admin-password-long-enough-too";
const { hashPassword } = await import("better-auth/crypto");
const setup = await performSetup({
  token: "ownership-setup-token",
  displayName: "所有者",
  email: "owner@example.com",
  password: OWNER_PASSWORD,
});
if (!setup.ok) throw new Error(`setup failed: ${setup.error}`);

const ownerUser = (
  await getDb()
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, "owner@example.com"))
)[0];
if (!ownerUser) throw new Error("owner user missing");

const onboarding = await completeOnboarding(ownerUser.id, {
  familyName: "所有权测试家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "孩子",
  childBirthDate: "2020-05-01",
  selfDisplayName: "所有者",
  selfRelationToChild: "妈妈",
});
if (!onboarding.ok) throw new Error(`onboarding failed: ${onboarding.error}`);
const familyId = onboarding.familyId;

const adminUserId = randomUUID();
const adminEmail = `admin-${adminUserId}@example.com`;
await getDb()
  .insert(userTable)
  .values({
    id: adminUserId,
    name: "管理员乙",
    email: adminEmail,
    emailVerified: true,
    role: "admin",
    familyId,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  .run();
// 真实凭据：移交给 admin 后由其发起回移时需要自己的密码。
await getDb()
  .insert(account)
  .values({
    id: randomUUID(),
    userId: adminUserId,
    accountId: adminEmail,
    providerId: "credential",
    password: await hashPassword(ADMIN_PASSWORD),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  .run();

async function ownerContext() {
  const binding = await getUserBinding(ownerUser.id);
  return {
    userId: ownerUser.id,
    userName: "所有者",
    familyId,
    personId: binding.personId,
    role: binding.role,
    accountEnabled: true as const,
    isGuardian: false,
    familyTimezone: "Asia/Shanghai",
    childLaterUnlockAge: 18,
  };
}

async function auditCount(): Promise<number> {
  return (await getDb().select({ id: auditLog.id }).from(auditLog)).length;
}

describe.sequential("ownership model (M2)", () => {
  it("first setup account is the owner; owner ⊇ admin plus family:transfer", async () => {
    const binding = await getUserBinding(ownerUser.id);
    expect(binding.role).toBe("owner");
    const { hasFamilyCapability } = await import("@/lib/authz/policy");
    expect(hasFamilyCapability("owner", "family:transfer")).toBe(true);
    expect(hasFamilyCapability("admin", "family:transfer")).toBe(false);
    expect(hasFamilyCapability("admin", "account:manage")).toBe(true);
    expect(hasFamilyCapability("owner", "account:manage")).toBe(true);
  });

  it("invitations can never grant the owner role", async () => {
    const owner = await ownerContext();
    const result = await createFamilyInvitation({
      familyId,
      actorUserId: owner.userId,
      role: "owner",
      email: null,
      personId: null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    expect(result.ok).toBe(false);
  });

  it("generic role changes cannot create or demote an owner", async () => {
    const owner = await ownerContext();
    expect(
      changeFamilyAccountRole(owner, adminUserId, "owner"),
    ).toMatchObject({ ok: false, error: "invalid_role" });
    expect(
      changeFamilyAccountRole(owner, ownerUser.id, "admin"),
    ).toMatchObject({ ok: false, error: "owner_transfer_required" });
    expect(
      disableFamilyAccount(owner, ownerUser.id),
    ).toMatchObject({ ok: false, error: "cannot_disable_self" });
  });

  it("transferOwnership verifies password, swaps atomically, writes audit", async () => {
    const owner = await ownerContext();
    const before = await auditCount();

    // 密码错误：动作前拒绝，零写入。
    expect(
      await verifyCurrentPassword(ownerUser.id, "wrong-password"),
    ).toBe(false);
    const wrong = await transferOwnership({
      context: owner,
      targetUserId: adminUserId,
      currentPassword: "wrong-password",
    });
    expect(wrong).toMatchObject({ ok: false, error: "password_required" });
    expect(await auditCount()).toBe(before);

    expect(
      await verifyCurrentPassword(ownerUser.id, OWNER_PASSWORD),
    ).toBe(true);

    // 目标必须是 admin：对 viewer 目标拒绝。
    const viewerId = randomUUID();
    await getDb()
      .insert(userTable)
      .values({
        id: viewerId,
        name: "查看者",
        email: `viewer-${viewerId}@example.com`,
        emailVerified: true,
        role: "viewer",
        familyId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    expect(
      await transferOwnership({
        context: owner,
        targetUserId: viewerId,
        currentPassword: OWNER_PASSWORD,
      }),
    ).toMatchObject({ ok: false, error: "invalid_target" });

    const result = await transferOwnership({
      context: owner,
      targetUserId: adminUserId,
      currentPassword: OWNER_PASSWORD,
    });
    expect(result).toEqual({ ok: true });
    expect(await auditCount()).toBe(before + 1);

    const roles = await getDb()
      .select({ id: userTable.id, role: userTable.role })
      .from(userTable);
    expect(roles.find((r) => r.id === ownerUser.id)?.role).toBe("admin");
    expect(roles.find((r) => r.id === adminUserId)?.role).toBe("owner");

    // 旧 owner（现为 admin）不再持有移交能力：能力断言直接抛出（与服务层约定一致）。
    await expect(
      transferOwnership({
        context: { ...owner, role: "admin" },
        targetUserId: ownerUser.id,
        currentPassword: OWNER_PASSWORD,
      }),
    ).rejects.toThrow(/family:transfer/);

    // 移交回去，保持用例稳定。
    const newOwnerBinding = await getUserBinding(adminUserId);
    expect(
      await transferOwnership({
        context: {
          userId: adminUserId,
          userName: "管理员乙",
          familyId,
          personId: null,
          role: newOwnerBinding.role,
          accountEnabled: true as const,
          isGuardian: false,
          familyTimezone: "Asia/Shanghai",
          childLaterUnlockAge: 18,
        },
        targetUserId: ownerUser.id,
        currentPassword: ADMIN_PASSWORD,
      }),
    ).toEqual({ ok: true });
    expect(
      (
        await getDb()
          .select({ role: userTable.role })
          .from(userTable)
          .where(eq(userTable.id, ownerUser.id))
      )[0]?.role,
    ).toBe("owner");
  });

  it("lists own sessions, marks current, revokes only others", async () => {
    const owner = await ownerContext();
    const db = getDb();
    // setup/signUpEmail 可能留下真实会话;先清干净再构造已知集合。
    db.delete(session).where(eq(session.userId, ownerUser.id)).run();
    const currentId = randomUUID();
    const otherId = randomUUID();
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    db.insert(session)
      .values([
        { id: currentId, userId: ownerUser.id, token: "hash-current", expiresAt: expiry, createdAt: new Date(), ipAddress: "127.0.0.1", userAgent: "Windows browser" },
        { id: otherId, userId: ownerUser.id, token: "hash-other", expiresAt: expiry, createdAt: new Date(), ipAddress: "10.0.0.8", userAgent: "FamilyTimeCapsule Android" },
        { id: randomUUID(), userId: adminUserId, token: "hash-admin", expiresAt: expiry, createdAt: new Date() },
      ])
      .run();

    const list = listOwnSessions(owner, currentId);
    expect(Array.isArray(list)).toBe(true);
    if (Array.isArray(list)) {
      expect(list).toHaveLength(2);
      expect(list.find((row) => row.id === currentId)?.isCurrent).toBe(true);
      expect(list.find((row) => row.id === otherId)?.isCurrent).toBe(false);
    }

    const before = await auditCount();
    expect(revokeOtherSessions(owner, currentId)).toEqual({ ok: true });
    expect(await auditCount()).toBe(before + 1);

    const remainingSelf = db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, ownerUser.id))
      .all();
    expect(remainingSelf.map((row) => row.id)).toEqual([currentId]);
    const adminSessions = db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, adminUserId))
      .all();
    expect(adminSessions).toHaveLength(1);

    db.delete(session).where(eq(session.userId, ownerUser.id)).run();
    db.delete(session).where(eq(session.userId, adminUserId)).run();
  });
});
