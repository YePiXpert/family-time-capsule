import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * 家庭域模型（Issue #003，PRD §10）。
 *
 * Person 表示现实中的家庭成员，不等于登录账号（User）；
 * 没有任何 User 的 Person（祖辈、女儿本人）也必须完整存在。
 */

const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAtColumn = () =>
  integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const family = sqliteTable("family", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // IANA 时区名（如 Asia/Shanghai），#006 起用于 EXIF 时间缺时区的解释
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const person = sqliteTable(
  "person",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    // 对孩子的称谓，如「妈妈」「外公」
    relationToChild: text("relation_to_child"),
    // 女儿/儿子档案；P0 每个家庭至少一个 child Person
    isChild: integer("is_child", { mode: "boolean" }).notNull().default(false),
    // YYYY-MM-DD（本地日历日，不带时区）
    birthDate: text("birth_date"),
    // 头像 Asset；Asset 表在 #004 引入后升级为 FK，先保持普通列
    avatarAssetId: text("avatar_asset_id"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index("person_family_idx").on(t.familyId)],
);
