import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { asset } from "./asset";
import { user } from "./auth";
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
    // Durable provenance for who actually entered the words. Legacy and
    // disaster-restored rows may be null; new interactive writes always set it.
    recordedByUserId: text("recorded_by_user_id").references(() => user.id),
    // Portable provenance survives family export where login credentials and
    // local User ids are intentionally excluded.
    recordedByPersonId: text("recorded_by_person_id").references(() => person.id),
    recordedByNameSnapshot: text("recorded_by_name_snapshot"),
    recordingMode: text("recording_mode").notNull().default("legacy"),
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
    // M7 Trash：软删除时间；非空 = 回收站中
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (t) => [
    index("contribution_event_idx").on(t.memoryEventId),
    index("contribution_author_idx").on(t.authorPersonId),
    index("contribution_recorded_by_user_idx").on(t.recordedByUserId),
    index("contribution_recorded_by_person_idx").on(t.recordedByPersonId),
    index("contribution_event_visibility_author_idx").on(
      t.memoryEventId,
      t.visibility,
      t.authorPersonId,
    ),
    index("contribution_audio_asset_idx").on(t.audioAssetId),
    check(
      "contribution_recording_provenance_check",
      sql`(
        (${t.recordingMode} = 'legacy'
          and ${t.recordedByUserId} is null
          and ${t.recordedByPersonId} is null
          and ${t.recordedByNameSnapshot} is null)
        or
        (${t.recordingMode} = 'self'
          and ${t.recordedByPersonId} is not null
          and ${t.recordedByPersonId} = ${t.authorPersonId}
          and ${t.recordedByNameSnapshot} is not null
          and length(trim(${t.recordedByNameSnapshot})) between 1 and 50)
        or
        (${t.recordingMode} = 'on_behalf'
          and (${t.recordedByPersonId} is null or ${t.recordedByPersonId} <> ${t.authorPersonId})
          and ${t.recordedByNameSnapshot} is not null
          and length(trim(${t.recordedByNameSnapshot})) between 1 and 50)
      )`,
    ),
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
