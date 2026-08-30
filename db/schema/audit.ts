import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { family } from "./family";
import { user } from "./auth";

/**
 * 操作审计（v0.1.3，SECURITY.md backlog 落地）。
 * 记录影响整份档案的高价值操作（导出/恢复）；只增不改；
 * 按家庭隔离；不随导出/恢复流转（实例本地审计）。
 */
const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    // export.created | restore.completed | ...
    kind: text("kind").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    detailJson: text("detail_json").notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [index("audit_family_created_idx").on(t.familyId, t.createdAt)],
);
