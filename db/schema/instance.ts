import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * 实例级键值元数据（1.3）：
 * - instanceId：可公开的稳定随机标识，供客户端识别“同一个自托管实例”；
 *   不是凭据，不能据此放行任何权限。
 * 只存可公开的值；密钥与令牌绝不进入本表。
 */
export const instanceMeta = sqliteTable("instance_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
