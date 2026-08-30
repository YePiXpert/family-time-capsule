import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  // better-auth 的 name 即显示名称（displayName）
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  // 自定义字段：角色在 #003 完整建模前先固定 admin
  role: text("role").notNull().default("admin"),
  // #003：登录账号 ↔ 家庭 / 现实人物 的业务关联（明确 FK，可空）
  familyId: text("family_id").references(() => family.id, {
    onDelete: "set null",
  }),
  personId: text("person_id").references(() => person.id, {
    onDelete: "set null",
  }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
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
