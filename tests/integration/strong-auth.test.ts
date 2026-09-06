import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

/**
 * M2-b 认证强化：通行密钥端点 + 账号恢复令牌（服务端全路径）。
 * 独立数据库；BETTER_AUTH_URL 固定为 http://localhost:3999（rpID=localhost）。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-strong-auth-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "strong-auth-setup-token";
process.env.AUTH_SECRET = "strong-auth-test-secret-0123456789";
process.env.BETTER_AUTH_URL = "http://localhost:3999";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const {
  passkey: passkeyTable,
  session: sessionTable,
  user: userTable,
  verification: verificationTable,
} = await import("@/db/schema/auth");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding } = await import("@/lib/family/service");
const { getAuth } = await import("@/lib/auth/auth");
const {
  issueAccountRecoveryToken,
  resetPasswordWithRecoveryToken,
  RECOVERY_ATTEMPT_LIMIT,
} = await import("@/lib/auth/account-recovery");
const { hashPassword, verifyPassword } = await import("better-auth/crypto");
const {
  createCredential,
  buildAuthenticationResponse,
  buildRegistrationResponse,
} = await import("../helpers/webauthn");

const RP = { rpId: "localhost", origin: "http://localhost:3999" };
const PASSWORD = "strong-auth-password-123";

const setup = await performSetup({
  token: "strong-auth-setup-token",
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
const onboarding = await completeOnboarding(ownerUser.id, {
  familyName: "强认证家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "孩子",
  childBirthDate: "2026-01-01",
  selfDisplayName: "管理员",
  selfRelationToChild: "妈妈",
});
if (!onboarding.ok) throw new Error(`onboarding failed: ${onboarding.error}`);

// 普通成员（owner 受“最后一个管理账号”触发器保护，不能直接停用）
const memberUserId = `member-${randomUUID()}`;
getDb()
  .insert(userTable)
  .values({
    id: memberUserId,
    name: "成员",
    email: "member@example.com",
    emailVerified: true,
    role: "contributor",
    familyId: onboarding.familyId,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  .run();
const { hashPassword: hashForInsert } = await import("better-auth/crypto");
getDb()
  .insert((await import("@/db/schema/auth")).account)
  .values({
    id: `acc-${randomUUID()}`,
    userId: memberUserId,
    accountId: memberUserId,
    providerId: "credential",
    password: await hashForInsert("member-password-12345"),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  .run();

type PasskeyApi = {
  passkeyRegisterOptions: (input: { headers: Headers }) => Promise<unknown>;
  passkeyRegisterVerify: (input: { headers: Headers; body: unknown }) => Promise<unknown>;
  passkeyAuthenticateOptions: (input: { body: unknown }) => Promise<unknown>;
  passkeyAuthenticateVerify: (input: { body: unknown }) => Promise<unknown>;
  passkeyList: (input: { headers: Headers }) => Promise<unknown>;
};
const passkeyApi = () => getAuth().api as unknown as PasskeyApi;

function bearerHeaders(token: string): Headers {
  return new Headers({ authorization: `Bearer ${token}` });
}

function makeSession(userId: string): string {
  const token = `st-${userId.slice(0, 8)}-${Math.random().toString(36).slice(2)}`;
  getDb()
    .insert(sessionTable)
    .values({
      id: `sess-${token}`,
      token,
      userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  return token;
}

describe("通行密钥端点", () => {
  it("注册需要登录会话", async () => {
    await expect(
      passkeyApi().passkeyRegisterOptions({ headers: new Headers() }),
    ).rejects.toThrow(/Unauthorized|unauthorized/u);
  });

  it("注册 → 列表 → 断言登录建会话 → counter 前进", async () => {
    const token = makeSession(ownerUser.id);
    const headers = bearerHeaders(token);

    const optionsResult = (await passkeyApi().passkeyRegisterOptions({
      headers,
    })) as unknown as { options?: { challenge: string } };
    expect(optionsResult.options?.challenge).toBeTruthy();

    const credential = createCredential();
    const registered = (await passkeyApi().passkeyRegisterVerify({
      headers,
      body: {
        credential: buildRegistrationResponse({
          credential,
          challenge: optionsResult.options!.challenge,
          origin: RP.origin,
          rpId: RP.rpId,
        }),
        label: "测试钥匙",
      } as never,
    })) as unknown as { ok?: boolean };
    expect(registered?.ok).toBe(true);

    const list = await getDb()
      .select()
      .from(passkeyTable)
      .where(eq(passkeyTable.userId, ownerUser.id))
      .all();
    expect(list).toHaveLength(1);
    expect(list[0]!.label).toBe("测试钥匙");
    expect(list[0]!.counter).toBe(0);

    const listResult = (await passkeyApi().passkeyList({ headers })) as unknown as {
      passkeys?: { label: string }[];
    };
    expect(listResult.passkeys?.[0]?.label).toBe("测试钥匙");

    // 断言登录（无会话头）
    const authOptions = (await passkeyApi().passkeyAuthenticateOptions({
      body: {} as never,
    })) as unknown as { options?: { challenge: string }; challengeId?: string };
    expect(authOptions.challengeId).toBeTruthy();
    const assertion = buildAuthenticationResponse({
      credential,
      challenge: authOptions.options!.challenge,
      origin: RP.origin,
      rpId: RP.rpId,
      signCount: 2,
      userHandle: ownerUser.id,
    });
    const verified = (await passkeyApi().passkeyAuthenticateVerify({
      body: { challengeId: authOptions.challengeId, credential: assertion } as never,
    })) as unknown as { ok?: boolean; token?: string };
    expect(typeof verified?.token).toBe("string");

    // counter 已推进，旧 counter 重放被拒
    const row = getDb()
      .select()
      .from(passkeyTable)
      .where(eq(passkeyTable.userId, ownerUser.id))
      .all()[0]!;
    expect(row.counter).toBe(2);
    const replayOptions = (await passkeyApi().passkeyAuthenticateOptions({
      body: {} as never,
    })) as unknown as { options?: { challenge: string }; challengeId?: string };
    const replay = buildAuthenticationResponse({
      credential,
      challenge: replayOptions.options!.challenge,
      origin: RP.origin,
      rpId: RP.rpId,
      signCount: 1, // 已存 counter=2，重放更低值被拒
    });
    await expect(
      passkeyApi().passkeyAuthenticateVerify({
        body: { challengeId: replayOptions.challengeId, credential: replay } as never,
      }),
    ).rejects.toThrow();
  });

  it("挑战一次性：重复使用 challengeId 被拒", async () => {
    const token = makeSession(ownerUser.id);
    const optionsResult = (await passkeyApi().passkeyRegisterOptions({
      headers: bearerHeaders(token),
    })) as unknown as { options?: { challenge: string } };
    const credential = createCredential();
    const registerOnce = async () =>
      passkeyApi().passkeyRegisterVerify({
        headers: bearerHeaders(token),
        body: {
          credential: buildRegistrationResponse({
            credential,
            challenge: optionsResult.options!.challenge,
            origin: RP.origin,
            rpId: RP.rpId,
          }),
        } as never,
      });
    await expect(registerOnce()).resolves.toBeTruthy();
    // 同一 challenge 已被消费：第二次注册直接拒绝
    await expect(registerOnce()).rejects.toThrow();
  });

  it("停用账号无法通过通行密钥登录", async () => {
    const token = makeSession(memberUserId);
    const optionsResult = (await passkeyApi().passkeyRegisterOptions({
      headers: bearerHeaders(token),
    })) as unknown as { options?: { challenge: string } };
    const credential = createCredential();
    await passkeyApi().passkeyRegisterVerify({
      headers: bearerHeaders(token),
      body: {
        credential: buildRegistrationResponse({
          credential,
          challenge: optionsResult.options!.challenge,
          origin: RP.origin,
          rpId: RP.rpId,
        }),
      } as never,
    });

    getDb()
      .update(userTable)
      .set({ disabledAt: new Date() })
      .where(eq(userTable.id, memberUserId))
      .run();
    const authOptions = (await passkeyApi().passkeyAuthenticateOptions({
      body: {} as never,
    })) as unknown as { options?: { challenge: string }; challengeId?: string };
    const assertion = buildAuthenticationResponse({
      credential,
      challenge: authOptions.options!.challenge,
      origin: RP.origin,
      rpId: RP.rpId,
      signCount: 5,
    });
    await expect(
      passkeyApi().passkeyAuthenticateVerify({
        body: { challengeId: authOptions.challengeId, credential: assertion } as never,
      }),
    ).rejects.toThrow(/账号或凭据不可用|unavailable/u);
    getDb()
      .update(userTable)
      .set({ disabledAt: null })
      .where(eq(userTable.id, memberUserId))
      .run();
  });
});

describe("本机账号恢复", () => {
  const EMAIL = "owner@example.com";

  it("未知邮箱与停用账号拒绝签发", () => {
    expect(issueAccountRecoveryToken({ email: "nobody@example.com" })).toEqual({
      ok: false,
      error: "user_not_found",
    });
    getDb()
      .update(userTable)
      .set({ disabledAt: new Date() })
      .where(eq(userTable.id, memberUserId))
      .run();
    expect(issueAccountRecoveryToken({ email: "member@example.com" })).toEqual({
      ok: false,
      error: "account_disabled",
    });
    getDb()
      .update(userTable)
      .set({ disabledAt: null })
      .where(eq(userTable.id, memberUserId))
      .run();
  });

  it("签发 → 重置 → 会话作废 → 令牌单次使用", async () => {
    makeSession(ownerUser.id); // 旧会话应被重置作废
    const issued = issueAccountRecoveryToken({ email: EMAIL });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const reset = await resetPasswordWithRecoveryToken({
      token: issued.token,
      newPassword: "recovered-password-456",
      clientKey: "test-client",
    });
    expect(reset).toEqual({ ok: true });

    // 密码确实变更
    const { account: accountTable } = await import("@/db/schema/auth");
    const stored = getDb()
      .select({ password: accountTable.password })
      .from(accountTable)
      .where(eq(accountTable.userId, ownerUser.id))
      .all()[0]!;
    expect(
      await verifyPassword({ password: "recovered-password-456", hash: stored.password ?? "" }),
    ).toBe(true);

    // 全部会话被撤销
    const sessions = getDb()
      .select({ id: sessionTable.id })
      .from(sessionTable)
      .where(eq(sessionTable.userId, ownerUser.id))
      .all();
    expect(sessions).toHaveLength(0);

    // 令牌一次性
    const replay = await resetPasswordWithRecoveryToken({
      token: issued.token,
      newPassword: "another-password-789",
      clientKey: "test-client-2",
    });
    expect(replay).toEqual({ ok: false, error: "invalid_token" });
  });

  it("新签发作废旧令牌；错误令牌计数限流", async () => {
    const first = issueAccountRecoveryToken({ email: EMAIL });
    const second = issueAccountRecoveryToken({ email: EMAIL });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const stale = await resetPasswordWithRecoveryToken({
      token: first.token,
      newPassword: "whatever-password-1",
      clientKey: "rl-client",
    });
    expect(stale).toEqual({ ok: false, error: "invalid_token" });

    for (let index = 0; index < RECOVERY_ATTEMPT_LIMIT.limit; index += 1) {
      const attempt = await resetPasswordWithRecoveryToken({
        token: "definitely-not-a-real-token-000",
        newPassword: "whatever-password-2",
        clientKey: "rl-client-2",
      });
      expect(attempt).toEqual({ ok: false, error: "invalid_token" });
    }
    const limited = await resetPasswordWithRecoveryToken({
      token: second.token,
      newPassword: "valid-new-password-3",
      clientKey: "rl-client-2",
    });
    expect(limited).toEqual({ ok: false, error: "rate_limited" });

    // verification 表不留陈旧恢复行
    const rows = getDb()
      .select()
      .from(verificationTable)
      .where(eq(verificationTable.identifier, `account-recovery:${EMAIL}`))
      .all();
    expect(rows).toHaveLength(1);
  });
});
