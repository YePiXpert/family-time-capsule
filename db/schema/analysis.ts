import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { aiJob } from "./ai-job";
import { asset } from "./asset";
import { family } from "./family";

/**
 * AssetAnalysis：图片/视频素材的机器视觉分析（Issue #M3-B / M3-G）。
 *
 * - 每个 asset 只有一行 analysis（rerun = upsert）；
 * - description / ocrText 是机器输出，可重建；不进入 portable archive；
 * - 只分析原始 asset（originalAssetId IS NULL）；图片走 original/thumbnail，
 *   视频走 ffmpeg 抽帧（video_frames），帧只作临时输入不落盘成 asset；
 * - analyzedVia 记录实际送入 vision provider 的输入形态
 *   （original / thumbnail / video_frames）。
 */

const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAtColumn = () =>
  integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const assetAnalysis = sqliteTable(
  "asset_analysis",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    ocrText: text("ocr_text"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    analyzedVia: text("analyzed_via").notNull(),
    createdByJobId: text("created_by_job_id"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("asset_analysis_asset_uidx").on(t.assetId),
    index("asset_analysis_family_idx").on(t.familyId),
    check(
      "asset_analysis_analyzed_via_check",
      sql`${t.analyzedVia} in ('original', 'thumbnail', 'video_frames')`,
    ),
  ],
);

export type AssetAnalysisRow = typeof assetAnalysis.$inferSelect;

/** Ephemeral normalized frame checkpoints, fenced by the existing job lease.
 * No image bytes, prompt, credentials or raw provider errors are stored. */
export const aiVideoFrame = sqliteTable("ai_video_frame", {
  jobId: text("job_id").notNull().references(() => aiJob.id, { onDelete: "cascade" }),
  frameIndex: integer("frame_index").notNull(),
  atMs: integer("at_ms").notNull(),
  frameSha256: text("frame_sha256").notNull(),
  promptVersion: text("prompt_version").notNull(),
  description: text("description").notNull(),
  ocrText: text("ocr_text"),
  createdAt: createdAtColumn(),
}, table => [
  primaryKey({ columns: [table.jobId, table.frameIndex] }),
  check("ai_video_frame_bounds", sql`typeof(${table.frameIndex}) = 'integer' and ${table.frameIndex} between 0 and 5 and typeof(${table.atMs}) = 'integer' and ${table.atMs} between 0 and 120000 and length(${table.description}) between 1 and 4000 and (${table.ocrText} is null or length(${table.ocrText}) <= 2000)`),
  check("ai_video_frame_identity", sql`length(${table.frameSha256}) = 64 and ${table.frameSha256} not glob '*[^0-9a-f]*' and length(${table.promptVersion}) between 1 and 64`),
]);
