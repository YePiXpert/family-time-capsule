import { randomUUID } from "node:crypto";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

/**
 * M2-c 成员生命周期与 step-up：
 * 退出/移除（ID-13）、删除账号（ID-14 匿名化删除）、近期重新认证（ID-10）。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-lifecycle-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "lifecycle-setup-token";
process.env.AUTH_SECRET = "lifecycle-test-secret-0123456789abcdef";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const {
  account: accountTable,
  session: sessionTable,
  user: userTable,
} = await import("@/db/schema/auth");
const { auditLog } = await import("@/db/schema/audit");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding } = await import("@/lib/family/service");
const {
  leaveFamily,
  removeFamilyMember,
  deleteOwnAccount,
} = await import("@/lib/accounts/service");
const { hasRecentAuth, markRecentAuth } = await import("@/lib/auth/step-up");
const { hashPassword } = await import("better-auth/crypto");

const OWNER_PASSWORD = "lifecycle-owner-password-long";
const setup = await performSetup({
  token: "lifecycle-setup-token",
  displayName: "所有者",
  email: "owner@example.com",
  password: OWNER_PASSWORD,
});
if (!setup.ok) throw new Error(`setup failed: ${setup.error}`);
const ownerUser = getDb()
  .select({ id: userTable.id })
  .from(userTable)
  .where(eq(userTable.email, "owner@example.com"))
  .all()[0];
if (!ownerUser) throw new Error("owner user missing");
const onboarding = await completeOnboarding(ownerUser.id, {
  familyName: "生命周期家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "孩子",
  childBirthDate: "2026-01-01",
  selfDisplayName: "所有者",
  selfRelationToChild: "妈妈",
});
if (!onboarding.ok) throw new Error(`onboarding failed: ${onboarding.error}`);
const familyId = onboarding.familyId;

async function makeUser(role: string, email: string): Promise<string> {
  const id = `u-${randomUUID()}`;
  const now = new Date();
  getDb()
    .insert(userTable)
    .values({
      id,
      name: email.split("@")[0]!,
      email,
      emailVerified: true,
      role,
      familyId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  getDb()
    .insert(accountTable)
    .values({
      id: `acc-${randomUUID()}`,
      userId: id,
      accountId: id,
      providerId: "credential",
      password: await hashPassword(`${email}-password-123456`),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

/** 返回会话行 ID（requireCurrentSessionId 语义），不是 bearer token。 */
function makeSession(userId: string): string {
  const token = `st-${Math.random().toString(36).slice(2)}`;
  const id = `sess-${Math.random().toString(36).slice(2)}`;
  const now = new Date();
  getDb()
    .insert(sessionTable)
    .values({
      id,
      token,
      userId,
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

function ownerContext() {
  return {
    userId: ownerUser.id,
    userName: "所有者",
    familyId,
    personId: null,
    role: "owner" as const,
    accountEnabled: true as const,
    isGuardian: true,
    familyTimezone: "Asia/Shanghai",
    childLaterUnlockAge: 18,
  };
}

describe("移出家庭（ID-13）", () => {
  it("管理员移出成员：解绑+会话撤销+审计；人物/讲述不删", async () => {
    const memberId = await makeUser("contributor", "member@example.com");
    makeSession(memberId);
    const result = removeFamilyMember(ownerContext(), memberId);
    expect(result).toEqual({ ok: true });
    const row = getDb()
      .select({ familyId: userTable.familyId, personId: userTable.personId })
      .from(userTable)
      .where(eq(userTable.id, memberId))
      .all()[0]!;
    expect(row.familyId).toBeNull();
    expect(row.personId).toBeNull();
    expect(
      getDb()
        .select({ id: sessionTable.id })
        .from(sessionTable)
        .where(eq(sessionTable.userId, memberId))
        .all(),
    ).toHaveLength(0);
    const audited = getDb()
      .select({ kind: auditLog.kind })
      .from(auditLog)
      .where(eq(auditLog.kind, "account.removed"))
      .all();
    expect(audited.length).toBeGreaterThan(0);
  });

  it("owner 不能被移出；不能移出自己；非管理员被拒", async () => {
    const adminId = await makeUser("admin", "admin2@example.com");
    const viewerId = await makeUser("viewer", "viewer@example.com");
    expect(
      removeFamilyMember(ownerContext(), ownerUser.id),
    ).toMatchObject({ error: "owner_transfer_required" });
    const adminContext = {
      userId: adminId,
      userName: "a",
      familyId,
      personId: null,
      role: "admin" as const,
      accountEnabled: true as const,
      isGuardian: false,
      familyTimezone: "Asia/Shanghai",
      childLaterUnlockAge: 18,
    };
    expect(removeFamilyMember(adminContext, adminId)).toMatchObject({ error: "forbidden" });
    const viewerContext = {
      userId: viewerId,
      userName: "v",
      familyId,
      personId: null,
      role: "viewer" as const,
      accountEnabled: true as const,
      isGuardian: false,
      familyTimezone: "Asia/Shanghai",
      childLaterUnlockAge: 18,
    };
    // viewer 无 account:manage 能力：按服务约定直接抛错
    expect(() => removeFamilyMember(viewerContext, adminId)).toThrow(/account:manage/u);
  });
});

describe("退出家庭（ID-13）", () => {
  it("成员自助退出：解绑+会话撤销+审计", async () => {
    const memberId = await makeUser("editor", "leaver@example.com");
    makeSession(memberId);
    const context = {
      userId: memberId,
      userName: "leaver",
      familyId,
      personId: null,
      role: "editor" as const,
      accountEnabled: true as const,
      isGuardian: false,
      familyTimezone: "Asia/Shanghai",
      childLaterUnlockAge: 18,
    };
    expect(leaveFamily(context)).toEqual({ ok: true });
    const row = getDb()
      .select({ familyId: userTable.familyId })
      .from(userTable)
      .where(eq(userTable.id, memberId))
      .all()[0]!;
    expect(row.familyId).toBeNull();
    expect(
      getDb()
        .select({ id: sessionTable.id })
        .from(sessionTable)
        .where(eq(sessionTable.userId, memberId))
        .all(),
    ).toHaveLength(0);
  });

  it("admin 在 owner 存在时可退出；owner 自身不能退出", async () => {
    const adminId = await makeUser("admin", "solo-admin@example.com");
    const context = {
      userId: adminId,
      userName: "solo",
      familyId,
      personId: null,
      role: "admin" as const,
      accountEnabled: true as const,
      isGuardian: false,
      familyTimezone: "Asia/Shanghai",
      childLaterUnlockAge: 18,
    };
    // owner（管理类）仍在家庭，admin 退出不破坏“至少一名可用管理员”
    expect(leaveFamily(context)).toEqual({ ok: true });
    // owner 自身不能退出
    expect(leaveFamily(ownerContext())).toMatchObject({ error: "owner_transfer_required" });
  });
});

describe("删除自己的账号（ID-14）", () => {
  it("密码错误拒绝；正确密码后匿名化+凭据全撤", async () => {
    const memberId = await makeUser("contributor", "deleter@example.com");
    const context = {
      userId: memberId,
      userName: "deleter",
      familyId,
      personId: null,
      role: "contributor" as const,
      accountEnabled: true as const,
      isGuardian: false,
      familyTimezone: "Asia/Shanghai",
      childLaterUnlockAge: 18,
    };
    const wrong = await deleteOwnAccount(context, "wrong-password-000000");
    expect(wrong).toMatchObject({ error: "invalid_password" });

    const sessionId = makeSession(memberId);
    const ok = await deleteOwnAccount(context, "deleter@example.com-password-123456");
    expect(ok).toEqual({ ok: true });
    const row = getDb()
      .select()
      .from(userTable)
      .where(eq(userTable.id, memberId))
      .all()[0]!;
    expect(row.email).toMatch(/^deleted-.*@deleted\.invalid$/u);
    expect(row.name).toBe("已删除账号");
    expect(row.disabledAt).not.toBeNull();
    expect(row.familyId).toBeNull();
    expect(
      getDb()
        .select({ id: sessionTable.id })
        .from(sessionTable)
        .where(eq(sessionTable.userId, memberId))
        .all(),
    ).toHaveLength(0);
    expect(
      getDb()
        .select({ id: accountTable.id })
        .from(accountTable)
        .where(eq(accountTable.userId, memberId))
        .all(),
    ).toHaveLength(0);
    expect(hasRecentAuth(sessionId)).toBe(false); // 会话已删
    const audited = getDb()
      .select({ kind: auditLog.kind })
      .from(auditLog)
      .where(eq(auditLog.kind, "account.deleted"))
      .all();
    expect(audited.length).toBeGreaterThan(0);
  });

  it("owner 删除自己被拒（先移交）", async () => {
    const result = await deleteOwnAccount(ownerContext(), OWNER_PASSWORD);
    expect(result).toMatchObject({ error: "owner_transfer_required" });
  });
});

describe("step-up 近期重新认证（ID-10）", () => {
  it("无标记为 false；密码复核成功后窗口内 true；错误密码不落标记", async () => {
    const sessionId = makeSession(ownerUser.id);
    // 刚登录的会话本身就满足近期认证——倒拨创建时间模拟超过窗口的旧会话
    getDb()
      .update(sessionTable)
      .set({ createdAt: new Date(Date.now() - 11 * 60 * 1000) })
      .where(eq(sessionTable.id, sessionId))
      .run();
    expect(hasRecentAuth(sessionId)).toBe(false);
    const wrong = await markRecentAuth(sessionId, "wrong-password-000000");
    expect(wrong).toBe(false);
    expect(hasRecentAuth(sessionId)).toBe(false);
    const ok = await markRecentAuth(sessionId, OWNER_PASSWORD);
    expect(ok).toBe(true);
    expect(hasRecentAuth(sessionId)).toBe(true);
  });

  it("窗口过期后失效", async () => {
    const sessionId = makeSession(ownerUser.id);
    expect(await markRecentAuth(sessionId, OWNER_PASSWORD)).toBe(true);
    const db = getDb();
    db.update(sessionTable)
      .set({ recentAuthAt: new Date(Date.now() - 11 * 60 * 1000) })
      .where(eq(sessionTable.id, sessionId))
      .run();
    expect(hasRecentAuth(sessionId)).toBe(false);
  });
});
