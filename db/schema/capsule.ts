import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { asset } from "./asset";
import { user } from "./auth";
import { person } from "./family";
import { contribution } from "./contribution";
import { family } from "./family";
import { memoryEvent } from "./memory";

/**
 * 时间胶囊（Issue #013，PRD §15）。
 * 封存首先是仪式感：seal 后普通 UI 不显示正文，但**不是物理加密**——
 * 管理员备份/导出（#014）始终完整包含，不存在无法恢复的数据。
 */

const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAtColumn = () =>
  integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const capsule = sqliteTable(
  "capsule",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // date: unlockValue=YYYY-MM-DD；age: unlockValue=年数（字符串存储）
    unlockType: text("unlock_type").notNull(),
    unlockValue: text("unlock_value").notNull(),
    // draft | sealed | opened
    status: text("status").notNull().default("draft"),
    sealedAt: integer("sealed_at", { mode: "timestamp" }),
    openedAt: integer("opened_at", { mode: "timestamp" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index("capsule_family_idx").on(t.familyId, t.status)],
);

export const capsuleAsset = sqliteTable(
  "capsule_asset",
  {
    id: text("id").primaryKey(),
    capsuleId: text("capsule_id")
      .notNull()
      .references(() => capsule.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (t) => [index("capsule_asset_capsule_idx").on(t.capsuleId)],
);

export const capsuleEvent = sqliteTable(
  "capsule_event",
  {
    id: text("id").primaryKey(),
    capsuleId: text("capsule_id")
      .notNull()
      .references(() => capsule.id, { onDelete: "cascade" }),
    memoryEventId: text("memory_event_id")
      .notNull()
      .references(() => memoryEvent.id, { onDelete: "cascade" }),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (t) => [index("capsule_event_capsule_idx").on(t.capsuleId)],
);

export const capsuleContribution = sqliteTable(
  "capsule_contribution",
  {
    id: text("id").primaryKey(),
    capsuleId: text("capsule_id")
      .notNull()
      .references(() => capsule.id, { onDelete: "cascade" }),
    contributionId: text("contribution_id")
      .notNull()
      .references(() => contribution.id, { onDelete: "cascade" }),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (t) => [index("capsule_contribution_capsule_idx").on(t.capsuleId)],
);

/**
 * 胶囊对话（M5，PRD §17）：封存时留下的未来问题 + 开启后家人的回答。
 *
 * - 问题只能在 draft 阶段添加/删除（封存后问题集固化）；
 * - 回答只能在胶囊解锁（opened / 已到期未开启）后提交；
 * - 回答是独立的增量行：封存的历史内容（事件/讲述/素材）永不因此改变；
 * - durable：两表均随家庭 archive 导出/恢复。
 */

export const futureQuestion = sqliteTable(
  "future_question",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    capsuleId: text("capsule_id")
      .notNull()
      .references(() => capsule.id, { onDelete: "cascade" }),
    questionText: text("question_text").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("future_question_capsule_idx").on(t.capsuleId),
    check(
      "future_question_text_check",
      sql`length(${t.questionText}) between 1 and 500`,
    ),
  ],
);

export const capsuleReply = sqliteTable(
  "capsule_reply",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => futureQuestion.id, { onDelete: "cascade" }),
    capsuleId: text("capsule_id")
      .notNull()
      .references(() => capsule.id, { onDelete: "cascade" }),
    authorPersonId: text("author_person_id").references(() => person.id, {
      onDelete: "set null",
    }),
    text: text("text"),
    /** 可选的录音/照片/视频原件 */
    assetId: text("asset_id").references(() => asset.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("capsule_reply_question_idx").on(t.questionId, t.createdAt),
    check(
      "capsule_reply_content_check",
      sql`(${t.text} is not null and length(${t.text}) between 1 and 10000) or ${t.assetId} is not null`,
    ),
  ],
);

export type FutureQuestionRow = typeof futureQuestion.$inferSelect;
export type CapsuleReplyRow = typeof capsuleReply.$inferSelect;
