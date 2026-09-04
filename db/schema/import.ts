import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { asset } from "./asset";
import { user } from "./auth";
import { family } from "./family";
import { inboxItem } from "./inbox";

const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAtColumn = () =>
  integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

/** A durable, user-visible batch. Temporary transfer state lives separately. */
export const importSession = sqliteTable(
  "import_session",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    // web | native | share | guest
    source: text("source").notNull(),
    // collecting | uploading | reviewing | completed | cancelled
    status: text("status").notNull().default("collecting"),
    totalCount: integer("total_count").notNull().default(0),
    completedCount: integer("completed_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    defaultTitle: text("default_title"),
    defaultOccurredAt: integer("default_occurred_at", { mode: "timestamp" }),
    defaultLocationText: text("default_location_text"),
    // Guest portals have no login principal, so this is deliberately nullable.
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("import_session_family_status_idx").on(t.familyId, t.status, t.updatedAt),
    check(
      "import_session_source_check",
      sql`${t.source} in ('web', 'native', 'share', 'guest')`,
    ),
    check(
      "import_session_status_check",
      sql`${t.status} in ('collecting', 'uploading', 'reviewing', 'completed', 'cancelled')`,
    ),
    check(
      "import_session_counts_check",
      sql`${t.totalCount} >= 0 and ${t.completedCount} >= 0 and ${t.failedCount} >= 0 and ${t.completedCount} + ${t.failedCount} <= ${t.totalCount}`,
    ),
  ],
);

/** Server-owned transfer state. The storage key is generated, never supplied by a client. */
export const uploadSession = sqliteTable(
  "upload_session",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    captureId: text("capture_id").notNull(),
    filename: text("filename").notNull(),
    declaredMime: text("declared_mime").notNull(),
    totalBytes: integer("total_bytes").notNull(),
    receivedBytes: integer("received_bytes").notNull().default(0),
    lastModified: integer("last_modified", { mode: "timestamp" }),
    // web | native | share | guest
    source: text("source").notNull(),
    importSessionId: text("import_session_id").references(() => importSession.id, {
      onDelete: "set null",
    }),
    tempStorageKey: text("temp_storage_key").notNull(),
    // created | uploading | completed | cancelled | failed | expired
    status: text("status").notNull().default("created"),
    errorCode: text("error_code"),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    finalAssetId: text("final_asset_id").references(() => asset.id, {
      onDelete: "set null",
    }),
    finalInboxItemId: text("final_inbox_item_id").references(() => inboxItem.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("upload_session_family_capture_uidx").on(t.familyId, t.captureId),
    uniqueIndex("upload_session_temp_key_uidx").on(t.tempStorageKey),
    index("upload_session_family_status_idx").on(t.familyId, t.status, t.updatedAt),
    index("upload_session_expiry_idx").on(t.status, t.expiresAt),
    index("upload_session_import_idx").on(t.familyId, t.importSessionId),
    check(
      "upload_session_source_check",
      sql`${t.source} in ('web', 'native', 'share', 'guest')`,
    ),
    check(
      "upload_session_status_check",
      sql`${t.status} in ('created', 'uploading', 'completed', 'cancelled', 'failed', 'expired')`,
    ),
    check(
      "upload_session_bytes_check",
      sql`${t.totalBytes} > 0 and ${t.receivedBytes} >= 0 and ${t.receivedBytes} <= ${t.totalBytes}`,
    ),
  ],
);

/** Relational per-file progress and final provenance for an import batch. */
export const importSessionItem = sqliteTable(
  "import_session_item",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    importSessionId: text("import_session_id")
      .notNull()
      .references(() => importSession.id, { onDelete: "cascade" }),
    captureId: text("capture_id").notNull(),
    uploadSessionId: text("upload_session_id").references(() => uploadSession.id, {
      onDelete: "set null",
    }),
    assetId: text("asset_id").references(() => asset.id, { onDelete: "set null" }),
    inboxItemId: text("inbox_item_id").references(() => inboxItem.id, {
      onDelete: "set null",
    }),
    // pending | uploading | completed | failed | cancelled
    status: text("status").notNull().default("pending"),
    errorCode: text("error_code"),
    sortOrder: integer("sort_order").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("import_session_item_capture_uidx").on(t.importSessionId, t.captureId),
    uniqueIndex("import_session_item_upload_uidx").on(t.uploadSessionId),
    index("import_session_item_family_idx").on(t.familyId, t.importSessionId, t.sortOrder),
    index("import_session_item_status_idx").on(t.importSessionId, t.status),
    check(
      "import_session_item_status_check",
      sql`${t.status} in ('pending', 'uploading', 'completed', 'failed', 'cancelled')`,
    ),
    check("import_session_item_order_check", sql`${t.sortOrder} >= 0`),
  ],
);
