import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { family } from "./family";
import { user } from "./auth";

/**
 * WebDAV 备份（M6，PRD §20）：BackupTarget 的运行历史。
 *
 * - 凭据只从环境变量读取（WEBDAV_URL / WEBDAV_USERNAME / WEBDAV_PASSWORD），
 *   绝不落库、不导出、不发客户端——没有安全的持久加密就没有持久存储；
 * - 每次备份：verified export → 远端临时上传 → 回读校验 → 原子改名
 *   （MOVE 不被支持时降级直传并如实记录）；
 * - WebDAV 只是 BackupTarget，不是主存储；失败可重试。
 */

const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const backupRun = sqliteTable(
  "backup_run",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    // pending | running | succeeded | failed
    status: text("status").notNull().default("pending"),
    remotePath: text("remote_path").notNull(),
    bytes: integer("bytes"),
    sha256: text("sha256"),
    /** verified-upload / direct-upload（MOVE 不可用时的降级） */
    strategy: text("strategy"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(1),
    triggeredByUserId: text("triggered_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    startedAt: createdAtColumn(),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
  },
  (t) => [
    index("backup_run_family_idx").on(t.familyId, t.startedAt),
    check("backup_run_status_check", sql`${t.status} in ('pending', 'running', 'succeeded', 'failed')`),
    check(
      "backup_run_sha_check",
      sql`${t.sha256} is null or length(${t.sha256}) = 64`,
    ),
  ],
);

export type BackupRunRow = typeof backupRun.$inferSelect;
