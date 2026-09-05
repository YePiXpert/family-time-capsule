import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { family, person } from "./family";
import { asset } from "./asset";
import { memoryEvent } from "./memory";
import { contribution } from "./contribution";
import { story } from "./story";
import { collection } from "./collection";
const timestamp = (name: string) =>
  integer(name, { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());
/** Story narrates; Collection organizes; BookProject owns publication editing. */
export const bookProject = sqliteTable(
  "book_project",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    ownerPersonId: text("owner_person_id").references(() => person.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    subtitle: text("subtitle").notNull().default(""),
    template: text("template", {
      enum: ["photos", "growth", "letters"],
    }).notNull(),
    audience: text("audience", { enum: ["personal", "family"] }).notNull(),
    pageSize: text("page_size", { enum: ["A4", "A5"] })
      .notNull()
      .default("A5"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    coverAssetId: text("cover_asset_id").references(() => asset.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: ["active", "finished"] })
      .notNull()
      .default("active"),
    draftKey: text("draft_key"),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (t) => [
    index("book_project_family_cursor_idx").on(t.familyId, t.updatedAt, t.id),
    uniqueIndex("book_project_active_draft_idx")
      .on(t.familyId, t.draftKey)
      .where(
        sql`${t.draftKey} is not null and ${t.deletedAt} is null and ${t.status}='active'`,
      ),
  ],
);
export const bookChapter = sqliteTable(
  "book_chapter",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => bookProject.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    index("book_chapter_project_position_idx").on(t.projectId, t.position),
  ],
);
export const bookBlock = sqliteTable(
  "book_block",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => bookProject.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => bookChapter.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: text("kind", {
      enum: ["text", "image", "double", "collage", "quote", "date"],
    }).notNull(),
    text: text("text").notNull().default(""),
    caption: text("caption").notNull().default(""),
    layoutJson: text("layout_json").notNull(),
  },
  (t) => [index("book_block_chapter_position_idx").on(t.chapterId, t.position)],
);
/** SourceRefs survive removal from current blocks because saved revisions still reference them. */
export const bookSourceRef = sqliteTable(
  "book_source_ref",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => bookProject.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["memory", "asset", "contribution", "story", "collection"],
    }).notNull(),
    memoryEventId: text("memory_event_id").references(() => memoryEvent.id, {
      onDelete: "set null",
    }),
    assetId: text("asset_id").references(() => asset.id, {
      onDelete: "set null",
    }),
    contributionId: text("contribution_id").references(() => contribution.id, {
      onDelete: "set null",
    }),
    storyId: text("story_id").references(() => story.id, {
      onDelete: "set null",
    }),
    collectionId: text("collection_id").references(() => collection.id, {
      onDelete: "set null",
    }),
    fingerprint: text("fingerprint").notNull(),
    label: text("label").notNull(),
    createdAt: timestamp("created_at"),
  },
  (t) => [index("book_source_project_idx").on(t.projectId)],
);
export const bookBlockSource = sqliteTable(
  "book_block_source",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => bookProject.id, { onDelete: "cascade" }),
    blockId: text("block_id")
      .notNull()
      .references(() => bookBlock.id, { onDelete: "cascade" }),
    sourceRefId: text("source_ref_id")
      .notNull()
      .references(() => bookSourceRef.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [
    uniqueIndex("book_block_source_unique_idx").on(t.blockId, t.sourceRefId),
    index("book_block_source_project_idx").on(t.projectId),
  ],
);
export const bookRevision = sqliteTable(
  "book_revision",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => bookProject.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    uniqueIndex("book_revision_project_unique_idx").on(t.projectId, t.revision),
  ],
);
