import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const family = sqliteTable(
  "family",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // IANA 时区名（如 Asia/Shanghai），#006 起用于 EXIF 时间缺时区的解释
    timezone: text("timezone").notNull().default("Asia/Shanghai"),
    // `child_later` Contributions unlock automatically at this age.
    childLaterUnlockAge: integer("child_later_unlock_age").notNull().default(18),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    check(
      "family_child_later_unlock_age_check",
      sql`typeof(${t.childLaterUnlockAge}) = 'integer' and ${t.childLaterUnlockAge} between 1 and 100`,
    ),
  ],
);

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
    // Explicit access policy. Never inferred from relationToChild labels.
    isGuardian: integer("is_guardian", { mode: "boolean" })
      .notNull()
      .default(false),
    // YYYY-MM-DD（本地日历日，不带时区）
    birthDate: text("birth_date"),
    // Admin-recorded, irreversible early unlock for this child.
    childLaterUnlockedAt: integer("child_later_unlocked_at", {
      mode: "timestamp",
    }),
    // 头像 Asset；Asset 表在 #004 引入后升级为 FK，先保持普通列
    avatarAssetId: text("avatar_asset_id"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("person_family_idx").on(t.familyId),
    check(
      "person_guardian_check",
      sql`${t.isChild} in (0, 1) and ${t.isGuardian} in (0, 1) and (${t.isGuardian} = 0 or ${t.isChild} = 0)`,
    ),
    check(
      "person_child_later_unlock_check",
      sql`${t.childLaterUnlockedAt} is null or (typeof(${t.childLaterUnlockedAt}) = 'integer' and ${t.childLaterUnlockedAt} >= 0 and ${t.isChild} = 1)`,
    ),
  ],
);
