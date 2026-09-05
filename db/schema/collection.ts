import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { family } from "./family";
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
