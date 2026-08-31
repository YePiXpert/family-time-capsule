import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { asset } from "./asset";
import { family } from "./family";

/**
 * AssetTranscript：音频/视频素材的机器转录与用户修订（Issue #M3-A）。
 *
 * - 每个 asset 只有一行 transcript（rerun = upsert）；
 * - rawTranscript 是机器输出，可重建；editedTranscript 是耐久家庭资料；
 * - AI rerun 只更新 rawTranscript/segmentsJson，永不覆盖 editedTranscript；
 * - 旧 contribution.transcript 列是未使用的占位列，不写入、不删除。
 */

const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAtColumn = () =>
  integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const assetTranscript = sqliteTable(
  "asset_transcript",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    language: text("language"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    rawTranscript: text("raw_transcript").notNull(),
    editedTranscript: text("edited_transcript"),
    segmentsJson: text("segments_json"),
    status: text("status").notNull().default("machine"),
    sourceSha256: text("source_sha256").notNull(),
    createdByJobId: text("created_by_job_id"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("asset_transcript_asset_uidx").on(t.assetId),
    index("asset_transcript_family_idx").on(t.familyId),
    check(
      "asset_transcript_status_check",
      sql`${t.status} in ('machine', 'user_edited')`,
    ),
  ],
);

export type AssetTranscriptRow = typeof assetTranscript.$inferSelect;
