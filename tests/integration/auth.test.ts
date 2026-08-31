import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

// 环境必须在动态导入前设置（顶层语句，不能放进 beforeAll）：
// lib/paths 在模块加载时读取 DATA_DIR
const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-auth-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "integration-setup-token";
process.env.AUTH_SECRET = "integration-test-secret";
process.env.AUTH_SIGNIN_RATE_LIMIT_MAX = "100";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup, getSetupState, countUsers } = await import(
  "@/lib/auth/setup"
);
const { getAuth } = await import("@/lib/auth/auth");
const { getDb } = await import("@/db");
const { account, session, user } = await import("@/db/schema/auth");
const { getUserBinding } = await import("@/lib/family/service");

const ADMIN = {
  token: "integration-setup-token",
  displayName: "爸爸",
  email: "Admin@Example.com",
  password: "a-long-enough-password",
};

// server 端 API 的错误可能以抛出或 error 字段两种形态出现，测试以 DB 为准
async function trySignIn(email: string, password: string): Promise<boolean> {
  const auth = getAuth();
  try {
    const r = await auth.api.signInEmail({ body: { email, password } });
    const maybe = r as { error?: unknown } | null;
    if (maybe && typeof maybe === "object" && "error" in maybe && maybe.error) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

describe("首次初始化（setup）", () => {
  it("无用户时 setup 可用", async () => {
    const state = await getSetupState();
    expect(state.hasUsers).toBe(false);
    expect(state.tokenConfigured).toBe(true);
  });

  it("token 错误时失败，且不创建用户", async () => {
    const result = await performSetup({
      ...ADMIN,
      token: "wrong-token",
    });
    expect(result).toEqual({ ok: false, error: "invalid_token" });
    expect(await countUsers()).toBe(0);
  });

  it("表单不合规时失败（短密码）", async () => {
    const result = await performSetup({
      ...ADMIN,
      password: "short",
    });
    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(await countUsers()).toBe(0);
  });

  it("正确 token 创建首个 admin（邮箱小写、displayName 落在 name、role=admin）", async () => {
    const result = await performSetup(ADMIN);
    expect(result).toEqual({ ok: true });
    expect(await countUsers()).toBe(1);

    const db = getDb();
    const rows = await db.select().from(user);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("admin@example.com");
    expect(rows[0].name).toBe("爸爸");
    expect(rows[0].role).toBe("admin");
    expect(rows[0].createdAt).toBeInstanceOf(Date);
    expect(rows[0].updatedAt).toBeInstanceOf(Date);
  });

  it("密码不以明文保存（scrypt 哈希在 account 表）", async () => {
    const db = getDb();
    const rows = await db.select().from(account).where(eq(account.providerId, "credential"));
    expect(rows).toHaveLength(1);
    const stored = rows[0].password ?? "";
    expect(stored).not.toBe(ADMIN.password);
    expect(stored.length).toBeGreaterThanOrEqual(60);
    expect(stored).toContain(":"); // better-auth scrypt 格式 salt:hash
  });

  it("第二次 setup 被拒绝（即使 token 仍存在）", async () => {
    const result = await performSetup({
      ...ADMIN,
      email: "second@example.com",
    });
    expect(result).toEqual({ ok: false, error: "already_initialized" });
    expect(await countUsers()).toBe(1);
    const state = await getSetupState();
    expect(state.hasUsers).toBe(true);
  });
});

describe("登录", () => {
  it("错误密码登录失败", async () => {
    expect(await trySignIn("admin@example.com", "wrong-password-x")).toBe(false);
  });

  it("不存在邮箱登录失败", async () => {
    expect(await trySignIn("nobody@example.com", ADMIN.password)).toBe(false);
  });

  it("正确凭据登录成功并创建 session", async () => {
    expect(await trySignIn("admin@example.com", ADMIN.password)).toBe(true);
    const db = getDb();
    const sessions = await db.select().from(session);
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions[0].userId).toBeTruthy();
  });

  it("停用账号无法新建会话，且不会泄露成可用 principal", async () => {
    const db = getDb();
    const admin = (await db.select({ id: user.id }).from(user))[0];
    await db
      .update(user)
      .set({ disabledAt: new Date() })
      .where(eq(user.id, admin.id));

    expect(await trySignIn("admin@example.com", ADMIN.password)).toBe(false);
    expect(await db.select({ id: session.id }).from(session)).toHaveLength(0);
    await expect(getUserBinding(admin.id)).rejects.toMatchObject({
      code: "account_disabled",
    });

    await db
      .update(user)
      .set({ disabledAt: null, disabledByUserId: null })
      .where(eq(user.id, admin.id));
    expect(await trySignIn("admin@example.com", ADMIN.password)).toBe(true);
  });
});
