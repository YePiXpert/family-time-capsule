import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * RH-010：公开注册回归闸门。
 * better-auth 的 /sign-up/email 端点默认对外暴露——若不加闸门，
 * 任何人都可通过 HTTP 直接创建账号（等于公开注册，违反 docs/SECURITY.md §1）。
 * 修复：所有 HTTP 请求一律拒绝；只有 /setup 校验 INITIAL_SETUP_TOKEN 后的
 * 内部 auth.api 调用可在零用户时创建首个管理员。
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

async function httpSignUp(name: string, email: string, password: string) {
  return getAuth().handler(
    new Request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({ name, email, password }),
    }),
  );
}

describe("sign-up 闸门（RH-010）", () => {
  it("零用户时公开 HTTP 注册仍被拒绝", async () => {
    const response = await httpSignUp(
      "attacker",
      "attacker-before-setup@example.com",
      "attacker-password-123",
    );
    expect(response.status).toBe(403);
    expect((await getDb().select().from(userTable)).length).toBe(0);
  });

  it("正确 setup token 仍可通过内部 auth API 创建首个管理员", async () => {
    const r = await performSetup({
      token: "gate-token",
      displayName: "admin",
      email: "admin@example.com",
      password: "a-long-password-123",
    });
    expect(r).toEqual({ ok: true });
    expect((await getDb().select().from(userTable)).length).toBe(1);
  });

  it("已有用户后公开 HTTP 注册仍被拒绝", async () => {
    const response = await httpSignUp(
      "attacker",
      "attacker-after-setup@example.com",
      "attacker-password-123",
    );
    expect(response.status).toBe(403);
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
