import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

/**
 * M2-b 两步验证（TOTP + 恢复码）：better-auth twoFactor 插件端到端
 * （会话内启用/确认/禁用/重生成恢复码；密钥与恢复码加密存储不落明文）。
 * 登录第二腿（two-factor cookie）由 e2e security.spec 覆盖。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-two-factor-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "totp-setup-token";
process.env.AUTH_SECRET = "totp-test-secret-0123456789abcdef";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const {
  session: sessionTable,
  twoFactor: twoFactorTable,
  user: userTable,
} = await import("@/db/schema/auth");
const { performSetup } = await import("@/lib/auth/setup");
const { getAuth } = await import("@/lib/auth/auth");

const PASSWORD = "totp-password-long-enough";
const setup = await performSetup({
  token: "totp-setup-token",
  displayName: "管理员",
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

function makeSessionHeaders(): Headers {
  const token = `st-${Math.random().toString(36).slice(2)}`;
  getDb()
    .insert(sessionTable)
    .values({
      id: `sess-${token}`,
      token,
      userId: ownerUser.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  return new Headers({ authorization: `Bearer ${token}` });
}

// 测试内嵌的最小 RFC 6238 TOTP（HMAC-SHA1 / 30s / 6 位）
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input.replace(/=+$/u, "")) {
    const index = BASE32.indexOf(char.toUpperCase());
    if (index === -1) throw new Error("bad base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
function totp(secretBase32: string): string {
  const counter = Math.floor(Date.now() / 30_000);
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter % 2 ** 32, 4);
  const digest = createHmac("sha1", base32Decode(secretBase32)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(binary % 1_000_000).padStart(6, "0");
}
function secretFromUri(uri: string): string {
  return /[?&]secret=([A-Za-z2-7]+)/u.exec(uri)?.[1] ?? "";
}

describe("两步验证（TOTP）", () => {
  it("错误密码不能启用", async () => {
    await expect(
      getAuth().api.enableTwoFactor({
        headers: makeSessionHeaders(),
        body: { password: "wrong-password-000" },
      }),
    ).rejects.toThrow();
  });

  it("启用 → 动态码确认 → 状态与加密存储", async () => {
    const headers = makeSessionHeaders();
    const enableResult = (await getAuth().api.enableTwoFactor({
      headers,
      body: { password: PASSWORD },
    })) as unknown as { totpURI?: string; backupCodes?: string[] };
    expect(enableResult.totpURI).toMatch(/^otpauth:\/\/totp\//u);
    expect(enableResult.backupCodes?.length).toBeGreaterThanOrEqual(8);

    const row = getDb()
      .select()
      .from(twoFactorTable)
      .where(eq(twoFactorTable.userId, ownerUser.id))
      .all()[0]!;
    // 恢复码与密钥都不是明文（AEAD 加密信封形态），verified 待确认
    expect(row.secret).not.toContain("=");
    expect(row.backupCodes).not.toContain(enableResult.backupCodes![0]!);
    expect(row.verified).toBe(false);
    expect(
      getDb()
        .select({ enabled: userTable.twoFactorEnabled })
        .from(userTable)
        .where(eq(userTable.id, ownerUser.id))
        .all()[0]!.enabled,
    ).toBe(false);

    // 错误动态码不能确认
    await expect(
      getAuth().api.verifyTOTP({ headers, body: { code: "000000" } }),
    ).rejects.toThrow();

    const verified = await getAuth().api.verifyTOTP({
      headers,
      body: { code: totp(secretFromUri(enableResult.totpURI!)) },
    });
    expect(verified).toBeTruthy();
    expect(
      getDb()
        .select({ enabled: userTable.twoFactorEnabled })
        .from(userTable)
        .where(eq(userTable.id, ownerUser.id))
        .all()[0]!.enabled,
    ).toBe(true);
  });

  it("重新生成恢复码：旧码全量替换、新码可读一次", async () => {
    const headers = makeSessionHeaders();
    const before = getDb()
      .select({ backupCodes: twoFactorTable.backupCodes })
      .from(twoFactorTable)
      .where(eq(twoFactorTable.userId, ownerUser.id))
      .all()[0]!;
    const regenerated = (await getAuth().api.generateBackupCodes({
      headers,
      body: { password: PASSWORD },
    })) as unknown as { backupCodes?: string[] };
    expect(regenerated.backupCodes?.length).toBeGreaterThanOrEqual(8);
    const after = getDb()
      .select({ backupCodes: twoFactorTable.backupCodes })
      .from(twoFactorTable)
      .where(eq(twoFactorTable.userId, ownerUser.id))
      .all()[0]!;
    expect(after.backupCodes).not.toBe(before.backupCodes);
    expect(after.backupCodes).not.toContain(regenerated.backupCodes![0]!);
  });

  it("密码确认后可关闭两步验证", async () => {
    const headers = makeSessionHeaders();
    await expect(
      getAuth().api.disableTwoFactor({
        headers,
        body: { password: "wrong-password-000" },
      }),
    ).rejects.toThrow();
    await getAuth().api.disableTwoFactor({
      headers,
      body: { password: PASSWORD },
    });
    expect(
      getDb()
        .select({ enabled: userTable.twoFactorEnabled })
        .from(userTable)
        .where(eq(userTable.id, ownerUser.id))
        .all()[0]!.enabled,
    ).toBe(false);
  });
});
