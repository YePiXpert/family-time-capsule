import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { family } from "./family";
import { inboxItem } from "./inbox";

/**
 * 口述史收集（M5，PRD §15–16：Contribution Request / 匿名讲述链接）。
 *
 * - 持有人 token 永不入库：tokenHash 是 256-bit 随机 token 的 SHA-256；
 * - 链接可过期（expiresAt）、可撤销（closedAt）、范围受限（只能向本家庭
 *   收件箱提交内容，不能浏览/搜索/枚举任何家庭数据）；
 * - 访客提交进入现有收件箱审核队列（submission → inbox_item），
 *   绝不直接发布；审核状态由 inbox_item.status 派生，不冗余存储。
 */

const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAtColumn = () =>
  integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const contributionRequest = sqliteTable(
  "contribution_request",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /** 展示给访客的称呼（如「外婆」）；不暴露任何家庭内部数据 */
    recipientLabel: text("recipient_label").notNull(),
    /** 问题正文（来自内置问题库或家人自拟） */
    promptText: text("prompt_text").notNull(),
    /** 内置问题库的 topic key；自拟问题为 null */
    topicKey: text("topic_key"),
    // open | closed
    status: text("status").notNull().default("open"),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    closedAt: integer("closed_at", { mode: "timestamp" }),
    closedByUserId: text("closed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("contribution_request_token_hash_uidx").on(t.tokenHash),
    index("contribution_request_family_idx").on(t.familyId, t.status),
    check(
      "contribution_request_token_hash_check",
      sql`length(${t.tokenHash}) = 64`,
    ),
    check("contribution_request_status_check", sql`${t.status} in ('open', 'closed')`),
    check(
      "contribution_request_label_check",
      sql`length(${t.recipientLabel}) between 1 and 50`,
    ),
    check(
      "contribution_request_prompt_check",
      sql`length(${t.promptText}) between 1 and 500`,
    ),
  ],
);

export const contributionRequestSubmission = sqliteTable(
  "contribution_request_submission",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    requestId: text("request_id")
      .notNull()
      .references(() => contributionRequest.id, { onDelete: "cascade" }),
    /** 提交落在收件箱的条目；审核（确认进时间轴/丢弃）走既有收件箱流程 */
    inboxItemId: text("inbox_item_id")
      .notNull()
      .references(() => inboxItem.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("contribution_request_submission_request_idx").on(t.requestId, t.createdAt),
    index("contribution_request_submission_family_idx").on(t.familyId),
  ],
);

export type ContributionRequestRow = typeof contributionRequest.$inferSelect;
export type ContributionRequestSubmissionRow =
  typeof contributionRequestSubmission.$inferSelect;
