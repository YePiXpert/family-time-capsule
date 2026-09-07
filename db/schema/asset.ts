import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { family } from "./family";
import { user } from "./auth";

/**
 * Asset：原始素材与衍生物（Issue #004，PRD §10）。
 *
 * - capturedAt（真实发生时间）与 importedAt（导入时间）永不混淆；
 * - timeSource 记录时间来源：user_confirmed > embedded_metadata > file_metadata > import_time；
 * - sha256 用于原件去重（家庭内唯一）与导出校验；
 * - 原件（derivativeType=null）不可覆盖；衍生物通过 originalAssetId 指回原件，可随时重建。
 */

const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const asset = sqliteTable(
  "asset",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    // image | video | audio | document
    type: text("type").notNull(),
    // 上传时的文件名，仅作展示；绝不参与磁盘路径
    originalFilename: text("original_filename").notNull(),
    displayName: text("display_name"),
    nameSource: text("name_source").notNull().default("legacy_unknown"),
    nameRevision: integer("name_revision").notNull().default(0),
    participantIdsJson: text("participant_ids_json").notNull().default("[]"),
    metadataRevision: integer("metadata_revision").notNull().default(0),
    mimeType: text("mime_type").notNull(),
    bytes: integer("bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),

    capturedAt: integer("captured_at", { mode: "timestamp" }),
    importedAt: integer("imported_at", { mode: "timestamp" }).notNull(),
    // user_confirmed | embedded_metadata | file_metadata | import_time
    timeSource: text("time_source").notNull(),

    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    // 原始 metadata（EXIF/容器等）的 JSON 快照，只增不改
    metadataJson: text("metadata_json"),

    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // 正式 1.0 §5：family=家庭共享（默认，历史素材语义不变）；
    // private=仅上传者与通过引用它的可读对象（私密记忆/讲述）可见。
    visibility: text("visibility").notNull().default("family"),

    // 衍生物 → 原件（自引用）；原件两列为 null
    originalAssetId: text("original_asset_id").references(
      (): AnySQLiteColumn => asset.id,
      { onDelete: "cascade" },
    ),
    // thumbnail | preview | transcode | waveform
    derivativeType: text("derivative_type"),

    createdAt: createdAtColumn(),
  },
  (t) => [
    // 仅家庭共享原件按家庭 + SHA-256 精确去重；不同成员的私密原件允许
    // 同字节并存（重复上传不能探测他人私密原件的存在）。跨家庭仍允许
    // 相同原件（数据隔离边界是 family）。
    uniqueIndex("asset_family_sha_idx")
      .on(t.familyId, t.sha256)
      .where(sql`${t.originalAssetId} is null and ${t.visibility} = 'family'`),
    index("asset_private_owner_sha_idx")
      .on(t.familyId, t.createdByUserId, t.sha256)
      .where(sql`${t.originalAssetId} is null and ${t.visibility} = 'private'`),
    index("asset_family_created_idx").on(t.familyId, t.createdAt),
  ],
);

/** Bounded, inert UTF-8 extraction for TXT/Markdown preview and local FTS. */
export const documentText = sqliteTable(
  "document_text",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    truncated: integer("truncated", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("document_text_asset_uidx").on(t.assetId),
    index("document_text_family_idx").on(t.familyId, t.assetId),
  ],
);
