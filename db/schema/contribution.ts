import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { asset } from "./asset";
import { person } from "./family";
import { memoryEvent } from "./memory";

/**
 * Contribution：同一事件多个家人的独立视角（Issue #012，PRD §10）。
 * author 是 Person 不是 User——爸爸登录也可以替外婆记录「外婆说」。
 * 行级独立：妈妈编辑自己的行永远不会覆盖爸爸的行。
 */

const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAtColumn = () =>
  integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const contribution = sqliteTable(
  "contribution",
  {
    id: text("id").primaryKey(),
    memoryEventId: text("memory_event_id")
      .notNull()
      .references(() => memoryEvent.id, { onDelete: "cascade" }),
    authorPersonId: text("author_person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    // 口述原稿 / 手写正文
    rawText: text("raw_text"),
    audioAssetId: text("audio_asset_id").references(() => asset.id, {
      onDelete: "set null",
    }),
    transcript: text("transcript"),
    // 编辑后的定稿（P0 手工编辑；P1 转录）
    editedText: text("edited_text"),
    // private | parents | family | child_later
    visibility: text("visibility").notNull().default("family"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("contribution_event_idx").on(t.memoryEventId),
    index("contribution_author_idx").on(t.authorPersonId),
  ],
);

/**
 * Fact：可确认事实（PRD §10）。P0 只允许用户手工创建/确认；
 * AI（P1 起）只能产出 ai_suggested，永不自动升级为 user_confirmed（事实锁）。
 * P0 不建 sourceRef 关系表（无来源关联需求），P1 需要时再加。
 */
export const fact = sqliteTable(
  "fact",
  {
    id: text("id").primaryKey(),
    memoryEventId: text("memory_event_id")
      .notNull()
      .references(() => memoryEvent.id, { onDelete: "cascade" }),
    statement: text("statement").notNull(),
    // ai_suggested | user_confirmed | rejected
    status: text("status").notNull().default("user_confirmed"),
    confidence: integer("confidence"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index("fact_event_idx").on(t.memoryEventId)],
);
