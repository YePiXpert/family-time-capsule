import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { asset } from "./asset";
import { user } from "./auth";
import { family, person } from "./family";

/**
 * MemoryEvent：核心记忆事件（Issue #008，PRD §10）。
 * Asset 是证据，Event 才是时间轴上的「一件事」。
 * 关系走 memory_event_asset / memory_event_participant 关联表，不塞 JSON。
 */

const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAtColumn = () =>
  integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const memoryEvent = sqliteTable(
  "memory_event",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    childPersonId: text("child_person_id")
      .notNull()
      .references(() => person.id),
    title: text("title").notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp" }).notNull(),
    // exact | approximate | date_only
    occurredAtPrecision: text("occurred_at_precision").notNull().default("exact"),
    locationText: text("location_text"),
    coverAssetId: text("cover_asset_id").references(() => asset.id, {
      onDelete: "set null",
    }),
    // draft | confirmed | hidden
    status: text("status").notNull().default("confirmed"),
    // 展示快照（冗余）：child.birthDate + occurredAt 计算的满天数；
    // 时间轴展示仍按 birthDate 现算，快照仅用于导出与核对（#009）
    ageDays: integer("age_days"),
    // RH-003：最后编辑者（审计用最小实现；完整修订历史在 backlog）
    lastEditedByUserId: text("last_edited_by_user_id"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("memory_family_occurred_idx").on(t.familyId, t.occurredAt),
    index("memory_child_idx").on(t.childPersonId),
  ],
);

export const memoryEventAsset = sqliteTable(
  "memory_event_asset",
  {
    id: text("id").primaryKey(),
    memoryEventId: text("memory_event_id")
      .notNull()
      .references(() => memoryEvent.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("memory_event_asset_event_idx").on(t.memoryEventId),
    index("memory_event_asset_asset_idx").on(t.assetId),
  ],
);

export const memoryEventParticipant = sqliteTable(
  "memory_event_participant",
  {
    id: text("id").primaryKey(),
    memoryEventId: text("memory_event_id")
      .notNull()
      .references(() => memoryEvent.id, { onDelete: "cascade" }),
    personId: text("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("memory_participant_event_idx").on(t.memoryEventId),
    index("memory_participant_person_idx").on(t.personId),
  ],
);

/**
 * 事件编辑历史（v0.1.3，RH-003 backlog 落地）。
 * 每次编辑前保存一份「编辑前快照」：谁、何时、改了什么之前是什么。
 * 只增不改；跨家庭读取按 familyId 隔离；不随导出/恢复流转（实例本地审计）。
 */
export const memoryEventRevision = sqliteTable(
  "memory_event_revision",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    memoryEventId: text("memory_event_id")
      .notNull()
      .references(() => memoryEvent.id, { onDelete: "cascade" }),
    editedByUserId: text("edited_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // 编辑前快照：title/occurredAt/occurredAtPrecision/locationText/
    // coverAssetId/childPersonId/participantPersonIds/ageDays
    snapshotJson: text("snapshot_json").notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [index("revision_event_idx").on(t.memoryEventId, t.createdAt)],
);
