import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, count, eq, gt, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import {
  account,
  rateLimit,
  session,
  user,
  verification,
} from "@/db/schema/auth";
import { familyInvitation } from "@/db/schema/invitation";
import {
  getInvitationProvisioningCapability,
  recordInvitationProvisionedUser,
} from "./provisioning-capability";

/**
 * 会话策略（docs/SECURITY.md）：
 * - 密码用 better-auth 内置 scrypt 哈希，不自研协议；
 * - session cookie 由 better-auth 下发：HttpOnly、SameSite=Lax、生产环境 Secure；
 * - 内存版基础 rate-limit 默认在生产开启。
 *
 * 实例惰性创建：避免模块加载即打开数据库（构建期不触碰 DATA_DIR）。
 */

let authInstance: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  authInstance ??= createAuth();
  return authInstance;
}

/** @internal 仅供测试模拟进程重启（丢弃实例缓存；生产代码不得调用） */
export function __resetAuthInstanceForTests() {
  authInstance = undefined;
}

function createAuth() {
  return betterAuth({
    database: drizzleAdapter(getDb(), {
      provider: "sqlite",
      schema: { user, session, account, verification, rateLimit },
    }),
    secret: process.env.AUTH_SECRET || undefined,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 10,
      maxPasswordLength: 128,
    },
    advanced: {
      useSecureCookies: process.env.NODE_ENV === "production",
    },
    rateLimit: {
      // v0.1.3：显式启用（不依赖 NODE_ENV 推断），计数持久化到 SQLite
      // rate_limit 表（重启不清零；表定义见 db/schema/auth.ts）
      enabled: true,
      storage: "database",
      // better-auth 默认对 /sign-in/* 限 10 秒 3 次（防暴力破解）。
      // 保留该默认，但允许部署/测试环境通过环境变量放宽。
      customRules: {
        "/sign-in/email": {
          window: 10,
          max: Number(process.env.AUTH_SIGNIN_RATE_LIMIT_MAX ?? 3),
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 天
      updateAge: 60 * 60 * 24, // 滚动续期：每天刷新一次
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          defaultValue: "admin",
          input: false, // 角色由服务端控制，客户端不可传入
        },
        familyId: {
          type: "string",
          required: false,
          input: false, // 业务绑定只由服务端在 onboarding 时写入
        },
        personId: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // The binding comes from an active, DB-verified invitation claim,
          // never from the sign-up body (additionalFields remain input:false).
          // The user stays unbound and least-privileged until finalizeInvitation
          // atomically binds it and marks the invitation used.
          before: async (newUser) => {
            const provisioning = getInvitationProvisioningCapability();
            if (!provisioning) return;
            const now = new Date();
            const activeClaims = await getDb()
              .select({
                provisionedUserId: familyInvitation.provisionedUserId,
              })
              .from(familyInvitation)
              .where(
                and(
                  eq(familyInvitation.id, provisioning.invitationId),
                  eq(familyInvitation.claimNonce, provisioning.claimNonce),
                  gt(familyInvitation.claimExpiresAt, now),
                  gt(familyInvitation.expiresAt, now),
                  isNull(familyInvitation.usedAt),
                  isNull(familyInvitation.revokedAt),
                ),
              )
              .limit(1);
            const activeClaim = activeClaims[0];
            if (!activeClaim) {
              throw new APIError("FORBIDDEN", {
                message: "邀请不可用，请重新打开邀请链接。",
              });
            }
            // Better Auth's hook type declares id, but the email-signup path
            // may defer generation until after this hook. Supply it here so
            // the crash receipt is durable before the user INSERT. An expired
            // lease reuses the same id as a PK fence against a late old writer.
            const provisionedUserId =
              activeClaim.provisionedUserId || newUser.id || randomUUID();
            const reserved = getDb()
              .update(familyInvitation)
              .set({
                provisionedUserId,
                updatedAt: now,
              })
              .where(
                and(
                  eq(familyInvitation.id, provisioning.invitationId),
                  eq(familyInvitation.claimNonce, provisioning.claimNonce),
                  gt(familyInvitation.claimExpiresAt, now),
                  gt(familyInvitation.expiresAt, now),
                  or(
                    isNull(familyInvitation.provisionedUserId),
                    eq(
                      familyInvitation.provisionedUserId,
                      provisionedUserId,
                    ),
                  ),
                  isNull(familyInvitation.usedAt),
                  isNull(familyInvitation.revokedAt),
                ),
              )
              .run();
            if (reserved.changes !== 1) {
              throw new APIError("FORBIDDEN", {
                message: "邀请不可用，请重新打开邀请链接。",
              });
            }
            // Record the id before Better Auth inserts the user. If the process
            // dies on either side of that insert, the expired claim can delete
            // exactly this id without touching any account selected by email.
            recordInvitationProvisionedUser(provisionedUserId);
            return {
              data: {
                ...newUser,
                id: provisionedUserId,
                role: "viewer",
                familyId: null,
                personId: null,
              },
            };
          },
          after: async (newUser) => {
            recordInvitationProvisionedUser(newUser.id);
          },
        },
      },
    },
    hooks: {
      // RH-010：/sign-up/email 默认对外暴露，等于公开注册（与 docs/SECURITY.md §1 冲突）。
      // 所有 HTTP 请求一律拒绝；首次管理员只能由 /setup 校验
      // INITIAL_SETUP_TOKEN 后通过无 Request 的内部调用创建。后续账号还必须
      // 携带经过数据库 active-claim 复核的 AsyncLocalStorage 邀请 capability。
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email") {
          if (ctx.request) {
            throw new APIError("FORBIDDEN", {
              message: "注册已关闭。本实例为私人部署，首个管理员只能通过初始化页面创建。",
            });
          }

          const provisioning = getInvitationProvisioningCapability();
          if (provisioning) {
            const now = new Date();
            const rows = await getDb()
              .select({
                familyId: familyInvitation.familyId,
                role: familyInvitation.role,
                email: familyInvitation.email,
                personId: familyInvitation.personId,
              })
              .from(familyInvitation)
              .where(
                and(
                  eq(familyInvitation.id, provisioning.invitationId),
                  eq(familyInvitation.claimNonce, provisioning.claimNonce),
                  gt(familyInvitation.claimExpiresAt, now),
                  gt(familyInvitation.expiresAt, now),
                  isNull(familyInvitation.usedAt),
                  isNull(familyInvitation.revokedAt),
                ),
              )
              .limit(1);
            const invitation = rows[0];
            const requestEmail = String(
              (ctx.body as { email?: unknown } | undefined)?.email ?? "",
            )
              .trim()
              .toLowerCase();
            if (
              !invitation ||
              invitation.familyId !== provisioning.familyId ||
              invitation.role !== provisioning.role ||
              invitation.personId !== provisioning.personId ||
              requestEmail !== provisioning.accountEmail ||
              (invitation.email !== null && invitation.email !== requestEmail)
            ) {
              throw new APIError("FORBIDDEN", {
                message: "邀请不可用，请重新打开邀请链接。",
              });
            }
            return;
          }

          const db = getDb();
          const rows = await db.select({ value: count() }).from(user);
          if (Number(rows[0]?.value ?? 0) > 0) {
            throw new APIError("FORBIDDEN", {
              message: "注册已关闭。本实例为私人部署，账号由管理员创建。",
            });
          }
        }
      }),
    },
  });
}
