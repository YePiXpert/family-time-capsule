import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { family, person } from "./family";
import { user } from "./auth";
import { asset } from "./asset";
import { inboxItem } from "./inbox";
import { memoryEvent } from "./memory";

export const draft = sqliteTable("draft", {
  id: text("id").primaryKey(),
  familyId: text("family_id").notNull().references(() => family.id, { onDelete: "cascade" }),
  authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
  authorPersonId: text("author_person_id").references(() => person.id, { onDelete: "set null" }),
  authorName: text("author_name").notNull().default(""),
  title: text("title").notNull().default(""),
  text: text("text").notNull().default(""),
  occurredAt: text("occurred_at"),
  occurredAtPrecision: text("occurred_at_precision").notNull().default("exact"),
  locationText: text("location_text").notNull().default(""),
  participantIdsJson: text("participant_ids_json").notNull().default("[]"),
  visibility: text("visibility").notNull().default("family"),
  coverItemId: text("cover_item_id"),
  status: text("status").notNull().default("editing"),
  revision: integer("revision").notNull().default(0),
  mutationId: text("mutation_id").notNull(),
  inboxItemId: text("inbox_item_id").references(() => inboxItem.id, { onDelete: "set null" }),
  memoryEventId: text("memory_event_id").references(() => memoryEvent.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [index("draft_author_updated_idx").on(t.familyId, t.authorUserId, t.updatedAt)]);

export const draftItem = sqliteTable("draft_item", {
  id: text("id").primaryKey(),
  draftId: text("draft_id").notNull().references(() => draft.id, { onDelete: "cascade" }),
  assetId: text("asset_id").references(() => asset.id, { onDelete: "set null" }),
  localCaptureRef: text("local_capture_ref"),
  sortOrder: integer("sort_order").notNull(),
  caption: text("caption").notNull().default(""),
}, t => [uniqueIndex("draft_item_order_idx").on(t.draftId, t.sortOrder)]);
