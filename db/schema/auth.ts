import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { family, person } from "./family";

/**
 * better-auth 1.7 所需的表（字段名与 better-auth 内部模型一致，
 * 以 getAuthTables() 输出为准）。业务表（Family/Person/Asset…）在 db/schema/ 各域文件。
 *
 * #003：user 表增加 familyId / personId 业务 FK（可空——管理员在 /setup
 * 阶段尚无家庭，完成 onboarding 后绑定）。不复制第二套认证 User。
 */

const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAtColumn = () =>
  integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    // better-auth 的 name 即显示名称（displayName）
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    image: text("image"),
    role: text("role").notNull().default("admin"),
    // 登录账号 ↔ 家庭 / 现实人物 的业务关联（明确 FK，可空）
    familyId: text("family_id").references(() => family.id),
    personId: text("person_id").references(() => person.id),
    // better-auth twoFactor 插件：TOTP 是否已启用（ID-6）
    twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    // Accounts are retained for attribution and disabled instead of deleted.
    disabledAt: integer("disabled_at", { mode: "timestamp" }),
    disabledByUserId: text("disabled_by_user_id").references(
      (): AnySQLiteColumn => user.id,
      { onDelete: "set null" },
    ),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    // A real Person may exist without an account, but can never be represented
    // by two login principals. NULL remains allowed for unbound accounts.
    uniqueIndex("user_person_uidx")
      .on(table.personId)
      .where(sql`${table.personId} is not null`),
    index("user_family_role_disabled_idx").on(
      table.familyId,
      table.role,
      table.disabledAt,
    ),
    check(
      "user_disabled_at_check",
      sql`${table.disabledAt} is null or (typeof(${table.disabledAt}) = 'integer' and ${table.disabledAt} >= 0)`,
    ),
    check(
      "user_disabled_pair_check",
      sql`${table.disabledByUserId} is null or ${table.disabledAt} is not null`,
    ),
  ],
);

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  // step-up（ID-10）：最近一次密码复核时间；高敏操作要求在窗口内。
  recentAuthAt: integer("recent_auth_at", { mode: "timestamp" }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  issuer: text("issuer"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  // credential 登录方式的密码哈希（scrypt），永不明文
  password: text("password"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

/**
 * 持久化限流（v0.1.3）：better-auth `rateLimit.storage: "database"` 所需表。
 * 字段名与 @better-auth/core 的 rateLimit 模型一致（id 主键 / key 唯一 /
 * 次数 / 上次请求毫秒）。存 SQLite 后重启不清零、多实例共享（SECURITY.md §5）。
 */
export const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

/**
 * better-auth twoFactor 插件（ID-6/ID-8）：每账号一行 TOTP 密钥与恢复码。
 * secret/backupCodes 由插件用实例 AUTH_SECRET 派生密钥做 AEAD 加密存储
 * （xchacha20poly1305；密钥不落库）；恢复码只在生成响应里完整出现一次，
 * 每次使用即从加密列表中原子移除。verified/failed/locked 由插件防爆破。
 */
export const twoFactor = sqliteTable("two_factor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  verified: integer("verified", { mode: "boolean" }).notNull().default(true),
  failedVerificationCount: integer("failed_verification_count")
    .notNull()
    .default(0),
  lockedUntil: integer("locked_until", { mode: "timestamp" }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

/**
 * WebAuthn 通行密钥（ID-6）：credentialId 全局唯一（usernameless 登录取回）。
 * rpID 记录注册时的源（自托管域名），验证时必须匹配，防止跨源凭证混淆。
 * 本实现不经 better-auth 插件市场（1.7 未内置 passkey），由受审端点使用
 * @simplewebauthn/server 完成注册/断言验证后经 internalAdapter 建会话。
 */
export const passkey = sqliteTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    transports: text("transports"),
    deviceType: text("device_type"),
    backedUp: integer("backed_up", { mode: "boolean" }).notNull().default(false),
    rpId: text("rp_id").notNull(),
    label: text("label").notNull().default("通行密钥"),
    createdAt: createdAtColumn(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  },
  (table) => [index("passkey_user_idx").on(table.userId)],
);
