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
      },
    },
  });
}
