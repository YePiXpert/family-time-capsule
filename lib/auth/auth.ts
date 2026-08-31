import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { count } from "drizzle-orm";
import { getDb } from "@/db";
import {
  account,
  rateLimit,
  session,
  user,
  verification,
} from "@/db/schema/auth";

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
    hooks: {
      // RH-010：/sign-up/email 默认对外暴露，等于公开注册（与 docs/SECURITY.md §1 冲突）。
      // 所有 HTTP 请求一律拒绝；首次管理员只能由 /setup 校验
      // INITIAL_SETUP_TOKEN 后，通过不携带 Request 的服务端 auth.api 调用创建。
      // 内部调用仍以“数据库无用户”为一次性闸门。
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email") {
          if (ctx.request) {
            throw new APIError("FORBIDDEN", {
              message: "注册已关闭。本实例为私人部署，首个管理员只能通过初始化页面创建。",
            });
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
