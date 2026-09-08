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
      .references(() => person.id),
    title: text("title").notNull(),
    bodyText: text("body_text").notNull().default(""),
    titleSource: text("title_source").notNull().default("legacy_unknown"),
    titleRevision: integer("title_revision").notNull().default(0),
    occurredAt: integer("occurred_at", { mode: "timestamp" }).notNull(),
    // exact | approximate | date_only
    occurredAtPrecision: text("occurred_at_precision").notNull().default("exact"),
    locationText: text("location_text"),
    coverAssetId: text("cover_asset_id").references(() => asset.id, {
      onDelete: "set null",
    }),
    // draft | confirmed | hidden
    status: text("status").notNull().default("confirmed"),
    // 正式 1.0 §5 对象级读者：family=全家 | members=作者+指定读者 | private=仅作者。
    // 旧事件迁移为 family；createdByUserId 为空且非 family 时 fail closed。
    visibility: text("visibility").notNull().default("family"),
    createdByUserId: text("created_by_user_id"),
    // 可选成长节点展示信息；事件本体仍然是 MemoryEvent。
    // first_time | growth | family | learning | celebration | other
    milestoneType: text("milestone_type"),
    isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
    // 展示快照（冗余）：child.birthDate + occurredAt 计算的满天数；
    // 时间轴展示仍按 birthDate 现算，快照仅用于导出与核对（#009）
    ageDays: integer("age_days"),
    // RH-003：最后编辑者（审计用最小实现；完整修订历史在 backlog）
    lastEditedByUserId: text("last_edited_by_user_id"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    // M7 Trash：软删除时间；非空 = 回收站中（列表/导出/搜索均过滤）
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (t) => [
    index("memory_family_occurred_idx").on(t.familyId, t.occurredAt),
    index("memory_family_status_cursor_idx").on(
      t.familyId,
      t.status,
      t.occurredAt,
      t.id,
    ),
    index("memory_child_idx").on(t.childPersonId),
    index("memory_family_milestone_idx").on(
      t.familyId,
      t.isPinned,
      t.milestoneType,
      t.occurredAt,
    ),
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
    sortOrder: integer("sort_order").notNull().default(0),
    caption: text("caption").notNull().default(""),
    livePhotoGroupId: text("live_photo_group_id"),
    livePhotoRole: text("live_photo_role"),
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
 * 指定读者（正式 1.0 §5）：members 可见性事件的显式读者清单。
 * 参与人物不是读者；照片里出现妈妈不等于授权妈妈阅读。
 */
export const memoryEventReader = sqliteTable(
  "memory_event_reader",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    memoryEventId: text("memory_event_id")
      .notNull()
      .references(() => memoryEvent.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("memory_event_reader_event_idx").on(t.memoryEventId),
    index("memory_event_reader_user_idx").on(t.userId),
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
