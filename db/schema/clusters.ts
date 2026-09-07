import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
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

/**
 * ClusterFeatureCache（正式 1.0 §8 / FIND-5）：感知哈希特征持久缓存。
 *
 * - 键是「来源字节哈希 + 算法版本」：原件不可变（CAP-15），同一 SHA
 *   永远是同一画面，条目不会因内容变化而失效；
 * - 算法（dHash 尺寸/清晰度算法）升级时换版本字符串，旧行整体作废，
 *   下一次扫描按新版本重算并清理旧版本行；
 * - 只存派生特征（哈希位串与参考分），不含家庭/用户数据；纯运维可
 *   重建状态，不进入 portable family archive。
 */
export const clusterFeatureCache = sqliteTable(
  "cluster_feature_cache",
  {
    sha256: text("sha256").notNull(),
    algorithm: text("algorithm").notNull(),
    dhash: text("dhash").notNull(),
    focusScore: real("focus_score"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.sha256, t.algorithm] }),
    index("cluster_feature_cache_algorithm_idx").on(t.algorithm),
  ],
);

export type ClusterFeatureCacheRow = typeof clusterFeatureCache.$inferSelect;
