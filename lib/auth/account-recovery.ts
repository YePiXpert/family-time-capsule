import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { getDb } from "@/db";
import { account, session, user, verification } from "@/db/schema/auth";
import { recordAudit } from "@/lib/audit/service";

/**
 * 本机受审计账号恢复（ID-7/OPS-5；白皮书 §12「无邮件时的本机受审计恢复」）。
 *
 * 恢复令牌只能由部署者在服务器本机运行 CLI 创建（不暴露任何 HTTP 入口）：
 * - 令牌 256-bit 随机，只存 SHA-256，15 分钟过期；
 * - 每账号同时至多一个未用令牌（签发即替换旧的）；
 * - 使用是原子单次消费（DELETE ... RETURNING 抢占），并立刻作废全部会话；
 * - 全程写实例审计；不开启任何公开「忘记密码」后门。
 */

const RECOVERY_TTL_MS = 15 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;

function recoveryIdentifier(email: string): string {
  return `account-recovery:${email.trim().toLowerCase()}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export type IssueResult =
  | { ok: true; token: string; expiresAt: Date; email: string }
  | { ok: false; error: "user_not_found" | "account_disabled" };

/** 仅由本机 CLI 调用：为指定账号签发一次性恢复令牌。 */
export function issueAccountRecoveryToken(
  input: { email: string; now?: Date },
): IssueResult {
  const email = input.email.trim().toLowerCase();
  const db = getDb();
  const now = input.now ?? new Date();
  const target = db
    .select({
      id: user.id,
      disabledAt: user.disabledAt,
      familyId: user.familyId,
    })
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
    .all()[0];
  if (!target) return { ok: false, error: "user_not_found" };
  if (target.disabledAt !== null) return { ok: false, error: "account_disabled" };

  const token = randomBytes(32).toString("base64url");
  const identifier = recoveryIdentifier(email);
  db.transaction((tx) => {
    // 每账号同时至多一个有效令牌：旧的（含未过期与过期残留）一并清除。
    tx.delete(verification)
      .where(eq(verification.identifier, identifier))
      .run();
    tx.insert(verification)
      .values({
        id: randomUUID(),
        identifier,
        value: sha256Hex(token),
        expiresAt: new Date(now.getTime() + RECOVERY_TTL_MS),
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });
  if (target.familyId) {
    // CLI 即部署者本人；actorUserId 记录被恢复账号以便追踪。
    void recordAudit(target.familyId, "account.recovery_token_issued", target.id, {
      email,
      expiresAt: now.getTime() + RECOVERY_TTL_MS,
    });
  }
  return {
    ok: true,
    token,
    expiresAt: new Date(now.getTime() + RECOVERY_TTL_MS),
    email,
  };
}

export type ResetResult =
  | { ok: true }
  | { ok: false; error: "invalid_token" | "weak_password" | "rate_limited" };

export const RECOVERY_ATTEMPT_LIMIT = { limit: 5, windowMs: 15 * 60 * 1000 };

/** 校验令牌并设置新密码（原子单次使用，成功后撤销全部会话）。 */
export async function resetPasswordWithRecoveryToken(input: {
  token: string;
  newPassword: string;
  clientKey: string;
  now?: Date;
}): Promise<ResetResult> {
  const { consumeSecurityRateLimit } = await import("@/lib/security/rate-limit");
  const attempt = consumeSecurityRateLimit({
    scope: "account-recovery",
    subject: input.clientKey,
    limit: RECOVERY_ATTEMPT_LIMIT.limit,
    windowMs: RECOVERY_ATTEMPT_LIMIT.windowMs,
    now: input.now,
  });
  if (!attempt.allowed) return { ok: false, error: "rate_limited" };

  const token = input.token.trim();
  const password = input.newPassword;
  if (
    token.length < 20 ||
    token.length > 128 ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return { ok: false, error: "invalid_token" };
  }
  const db = getDb();
  const now = input.now ?? new Date();
  const hash = sha256Hex(token);

  const match = db
    .select()
    .from(verification)
    .where(
      and(
        eq(verification.value, hash),
        gt(verification.expiresAt, now),
      ),
    )
    .all()
    .find((row) => row.identifier.startsWith("account-recovery:"));
  if (!match) return { ok: false, error: "invalid_token" };

  const consumed = db
    .delete(verification)
    .where(and(eq(verification.id, match.id), eq(verification.value, hash)))
    .returning({ id: verification.id })
    .get();
  if (!consumed) return { ok: false, error: "invalid_token" };

  const email = match.identifier.slice("account-recovery:".length);
  const target = db
    .select({ id: user.id, familyId: user.familyId })
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
    .all()[0];
  if (!target) return { ok: false, error: "invalid_token" };

  const hashedPassword = await hashPassword(password);
  const existingCredential = db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, target.id), eq(account.providerId, "credential")))
    .limit(1)
    .all()[0];
  if (existingCredential) {
    db.update(account)
      .set({ password: hashedPassword, updatedAt: now })
      .where(eq(account.id, existingCredential.id))
      .run();
  } else {
    // 仅 Passkey 用户无 credential 账号：恢复时补建密码登录途径。
    db.insert(account)
      .values({
        id: randomUUID(),
        userId: target.id,
        accountId: target.id,
        providerId: "credential",
        password: hashedPassword,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
  // 重置密码即作废全部会话（改密后失效重入）
  db.delete(session).where(eq(session.userId, target.id)).run();
  if (target.familyId) {
    void recordAudit(
      target.familyId,
      "account.recovery_password_reset",
      target.id,
      { email },
    );
  }
  return { ok: true };
}
