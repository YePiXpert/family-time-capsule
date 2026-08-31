import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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
