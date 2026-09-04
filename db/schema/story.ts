import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { family } from "./family";

/**
 * Story / StoryParagraph / StorySource（M4，PRD §10–11：周记 / 月章 / 年章）。
 *
 * - 状态机：draft（生成或新建）→ edited（任何用户编辑后，再生保护生效）→
 *   published（定稿，随 archive 导出/恢复）；
 * - 再生保护：regenerate 永不覆盖 editedAt != null 或 published 的 Story，
 *   只会另建新 draft；
 * - Quote Lock：kind='quote' 的段落文本必须与其 contribution/transcript 来源
 *   逐字一致（服务层校验，不接受模型输出或客户端直接写入）；
 * - 段落来源只允许 user_confirmed Fact / family 可见 Contribution /
 *   用户修订 Transcript / 手写文字（user_text）；ai_suggested Fact 永不入故事。
 */

const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAtColumn = () =>
  integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const story = sqliteTable(
  "story",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    periodStart: integer("period_start", { mode: "timestamp" }).notNull(),
    periodEnd: integer("period_end", { mode: "timestamp" }).notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    /** 首次用户编辑时间：非空即受再生保护 */
    editedAt: integer("edited_at", { mode: "timestamp" }),
    publishedAt: integer("published_at", { mode: "timestamp" }),
    publishedByUserId: text("published_by_user_id"),
    createdByJobId: text("created_by_job_id"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    // M7 Trash：软删除时间；非空 = 回收站中
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (t) => [
    index("story_family_period_idx").on(t.familyId, t.kind, t.periodStart),
    index("story_family_status_idx").on(t.familyId, t.status),
    check("story_kind_check", sql`${t.kind} in ('weekly', 'monthly', 'yearly')`),
    check(
      "story_status_check",
      sql`${t.status} in ('draft', 'edited', 'published')`,
    ),
  ],
);

export const storyParagraph = sqliteTable(
  "story_paragraph",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    storyId: text("story_id")
      .notNull()
      .references(() => story.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("story_paragraph_story_idx").on(t.storyId, t.position),
    check("story_paragraph_kind_check", sql`${t.kind} in ('narrative', 'quote')`),
  ],
);

export const storySource = sqliteTable(
  "story_source",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    paragraphId: text("paragraph_id")
      .notNull()
      .references(() => storyParagraph.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    /** quote 段落的逐字引文（与段落文本一致，双记便于导出/追溯） */
    quote: text("quote"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("story_source_paragraph_idx").on(t.paragraphId),
    check(
      "story_source_type_check",
      sql`${t.sourceType} in ('fact', 'contribution', 'transcript', 'user_text', 'memory_event')`,
    ),
  ],
);

export type StoryRow = typeof story.$inferSelect;
export type StoryParagraphRow = typeof storyParagraph.$inferSelect;
export type StorySourceRow = typeof storySource.$inferSelect;
