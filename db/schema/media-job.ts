import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { family } from "./family";
import { user } from "./auth";
import { asset } from "./asset";
/** Rebuildable processing state; deliberately excluded from portable archives. */
export const mediaJob = sqliteTable(
  "media_job",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["preview", "transcode", "waveform"],
    }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "succeeded", "failed"],
    })
      .notNull()
      .default("queued"),
    outputAssetId: text("output_asset_id").references(() => asset.id, {
      onDelete: "set null",
    }),
    errorCode: text("error_code"),
    lease: text("lease"),
    leaseUntil: integer("lease_until", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("media_job_source_kind_idx").on(t.assetId, t.kind),
    index("media_job_queue_idx").on(t.status, t.createdAt),
  ],
);
