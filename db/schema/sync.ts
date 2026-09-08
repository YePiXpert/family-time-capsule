import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Instance-local synchronization metadata; no content or authentication secrets. */
export const syncState = sqliteTable("sync_state", {
  id: text("id").primaryKey(), generation: text("generation").notNull(),
  lastSeq: integer("last_seq").notNull().default(0), floorSeq: integer("floor_seq").notNull().default(0),
});
export const syncScope = sqliteTable("sync_scope", {
  familyId: text("family_id").primaryKey(), revision: integer("revision").notNull().default(0),
  permissionRevision: integer("permission_revision").notNull().default(0),
});
/** Delete audiences preserve only the ids necessary to deliver authorized tombstones. */
export const syncChange = sqliteTable("sync_change", {
  seq: integer("seq").primaryKey({ autoIncrement: true }), familyId: text("family_id").notNull(),
  kind: text("kind", { enum: ["memory", "person", "cache"] }).notNull(), entityId: text("entity_id"),
  operation: text("operation", { enum: ["upsert", "delete", "invalidate"] }).notNull(),
  visibility: text("visibility"), authorUserId: text("author_user_id"), readerIdsJson: text("reader_ids_json").notNull().default("[]"),
  resetScope: integer("reset_scope", { mode: "boolean" }).notNull().default(false),
  revocation: integer("revocation", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, t => [index("sync_change_family_seq_idx").on(t.familyId, t.seq)]);
/** Opaque random handles: sequence/activity and private ids never enter client cursors. */
export const syncCursor = sqliteTable("sync_cursor", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), familyId: text("family_id").notNull(),
  stateJson: text("state_json").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
}, t => [index("sync_cursor_user_created_idx").on(t.userId, t.createdAt), index("sync_cursor_expiry_idx").on(t.expiresAt)]);
