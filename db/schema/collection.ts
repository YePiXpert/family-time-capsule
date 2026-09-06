import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { family } from "./family";
import { user } from "./auth";
import { memoryEvent } from "./memory";
import { asset } from "./asset";
const created = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());
const updated = () =>
  integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());
export const collection = sqliteTable(
  "collection",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    coverAssetId: text("cover_asset_id").references(() => asset.id, {
      onDelete: "set null",
    }),
    startDate: text("start_date"),
    endDate: text("end_date"),
    sortMode: text("sort_mode").notNull().default("manual"),
    revision: integer("revision").notNull().default(1),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    index("collection_family_cursor_idx").on(t.familyId, t.updatedAt, t.id),
    check("collection_kind_check", sql`${t.kind} in ('album','chapter')`),
    check("collection_sort_check", sql`${t.sortMode} in ('manual','time')`),
    check("collection_revision_check", sql`${t.revision} >= 1`),
  ],
);
export const collectionSection = sqliteTable(
  "collection_section",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collection.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [index("collection_section_order_idx").on(t.collectionId, t.position)],
);
export const collectionItem = sqliteTable(
  "collection_item",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collection.id, { onDelete: "cascade" }),
    sectionId: text("section_id").references(() => collectionSection.id, {
      onDelete: "set null",
    }),
    memoryEventId: text("memory_event_id").references(() => memoryEvent.id, {
      onDelete: "set null",
    }),
    caption: text("caption").notNull().default(""),
    position: integer("position").notNull(),
  },
  (t) => [
    uniqueIndex("collection_item_source_uidx").on(
      t.collectionId,
      t.memoryEventId,
    ),
    index("collection_item_order_idx").on(t.collectionId, t.position),
  ],
);

/**
 * 访客限定阅读链接（M2-d，ID-5）：与投递箱（contribution_request，只提交）
 * 相对的只读 scope。令牌 256-bit 只存 SHA-256；撤销/过期即时生效；
 * 范围仅限单一相册（collection）；浏览留痕。
 */
export const guestReadGrant = sqliteTable(
  "guest_read_grant",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collection.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    title: text("title").notNull(),
    createdByUserId: text("created_by_user_id").references((): AnySQLiteColumn => user.id, {
      onDelete: "set null",
    }),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    viewCount: integer("view_count").notNull().default(0),
    lastViewedAt: integer("last_viewed_at", { mode: "timestamp" }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    index("guest_read_grant_family_idx").on(t.familyId, t.createdAt),
    index("guest_read_grant_collection_idx").on(t.collectionId),
  ],
);
