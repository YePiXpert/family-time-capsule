import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * RH-010：公开注册回归闸门。
 * better-auth 的 /sign-up/email 端点默认对外暴露——若不加闸门，
 * 任何人都可通过 HTTP 直接创建账号（等于公开注册，违反 docs/SECURITY.md §1）。
 * 修复：hooks.before 守卫，仅当数据库零用户时放行（与 /setup 闸门同语义）。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-signupgate-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "gate-token";
process.env.AUTH_SECRET = "gate-secret-0123456789abcdef";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const { getAuth } = await import("@/lib/auth/auth");
const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");

async function trySignUp(name: string, email: string, password: string) {
  try {
    const r = await getAuth().api.signUpEmail({
      body: { name, email, password },
    });
    const maybe = r as { error?: unknown };
    return maybe && typeof maybe === "object" && "error" in maybe && maybe.error
      ? { ok: false as const, reason: "error-field" }
      : { ok: true as const };
  } catch (e) {
    const err = e as { status?: string; statusCode?: number; message?: string };
    return {
      ok: false as const,
      status: err.status ?? err.statusCode,
      message: err.message,
    };
  }
}

describe("sign-up 闸门（RH-010）", () => {
  it("零用户时注册放行（这是 /setup 的内部路径）", async () => {
    const r = await performSetup({
      token: "gate-token",
      displayName: "admin",
      email: "admin@example.com",
      password: "a-long-password-123",
    });
    expect(r).toEqual({ ok: true });
    expect((await getDb().select().from(userTable)).length).toBe(1);
  });

  it("已有用户后：HTTP 同源的注册调用被 FORBIDDEN 拒绝", async () => {
    const attacker = await trySignUp(
      "attacker",
      "attacker@example.com",
      "attacker-password-123",
    );
    expect(attacker.ok).toBe(false);
    if (!attacker.ok && "status" in attacker) {
      // HTTP 端点 / 内部 api 同一 router：403 FORBIDDEN
      expect(String(attacker.status)).toBe("FORBIDDEN");
      expect(attacker.message).toContain("注册已关闭");
    }
    // 用户数不变
    expect((await getDb().select().from(userTable)).length).toBe(1);
  });

  it("登录不受闸门影响（合法管理员可正常登录）", async () => {
    const r = await getAuth().api
      .signInEmail({ body: { email: "admin@example.com", password: "a-long-password-123" } })
      .then(
        (res) => {
          const maybe = res as { error?: unknown };
          return !(maybe && typeof maybe === "object" && maybe.error);
        },
        () => false,
      );
    expect(r).toBe(true);
  });
});
