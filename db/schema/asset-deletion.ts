import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { family } from "./family";
import { user } from "./auth";
/** Logical removal and the durable, retryable physical cleanup receipt.
 * Archive projection contains only identity, hash and deletion time, never paths. */
export const assetDeletion = sqliteTable("asset_deletion", {
  assetId: text("asset_id").primaryKey(),
  familyId: text("family_id").notNull().references(() => family.id, { onDelete: "cascade" }),
  sha256: text("sha256").notNull(),
  deletedAt: text("deleted_at").notNull(),
  requestedByUserId: text("requested_by_user_id").references(() => user.id, { onDelete: "set null" }),
  storageKeysJson: text("storage_keys_json").notNull().default("[]"),
  cleanedAt: text("cleaned_at"),
}, t => [index("asset_deletion_family_idx").on(t.familyId, t.deletedAt), check("asset_deletion_sha_length", sql`length(${t.sha256})=64`), check("asset_deletion_cleanup_keys", sql`json_valid(${t.storageKeysJson}) and json_type(${t.storageKeysJson})='array'`)]);
