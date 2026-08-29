import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "@/db";
import {
  account,
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

function createAuth() {
  return betterAuth({
    database: drizzleAdapter(getDb(), {
      provider: "sqlite",
      schema: { user, session, account, verification },
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
  });
}
