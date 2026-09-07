import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { family, person } from "./family";
import { user } from "./auth";
import { memoryEvent } from "./memory";

/**
 * 回顾屏蔽（正式 1.0 §8 / FIND-9）：按用户记录的回顾偏好。
 * 只影响自动推荐（今天页面/回顾卡），不删除来源、不影响主动搜索与打开；
 * 是当前用户自己的偏好，不从其他家人的资料里删除任何内容。
 */
export const resurfacingPreference = sqliteTable(
  "resurfacing_preference",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // event | person | date_range | pause
    kind: text("kind").notNull(),
    targetKey: text("target_key").notNull(),
    dateFrom: text("date_from"),
    dateTo: text("date_to"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("resurfacing_preference_unique_idx").on(t.familyId, t.userId, t.kind, t.targetKey),
    index("resurfacing_preference_user_idx").on(t.familyId, t.userId),
  ],
);

export type ResurfacingPreferenceRow = typeof resurfacingPreference.$inferSelect;
