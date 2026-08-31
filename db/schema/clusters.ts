import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { family } from "./family";

/**
 * ClusterSuggestion（Issue #M3-D）：本地、无 AI 的收件箱分簇建议。
 *
 * - 完全本地计算（时间邻近、感知相似、Live Photo 配对），不触碰外部 AI；
 * - 所有建议都是可审的 pending 状态，用户接受后才调用已有 merge 流程；
 * - 运维/可重建状态，不进入 portable family archive。
 */

const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const clusterSuggestion = sqliteTable(
  "cluster_suggestion",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    inboxItemIdsJson: text("inbox_item_ids_json").notNull(),
    reasonText: text("reason_text").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: createdAtColumn(),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    resolvedByUserId: text("resolved_by_user_id"),
  },
  (t) => [
    index("cluster_suggestion_family_status_idx").on(t.familyId, t.status),
    check(
      "cluster_suggestion_kind_check",
      sql`${t.kind} in ('time_proximity', 'similar_media', 'live_photo_pair')`,
    ),
    check(
      "cluster_suggestion_status_check",
      sql`${t.status} in ('pending', 'accepted', 'dismissed')`,
    ),
  ],
);

export type ClusterSuggestionRow = typeof clusterSuggestion.$inferSelect;
