import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { asset } from "./asset";
import { family } from "./family";

/**
 * 收件箱（Issue #007，PRD §9.2）。
 * 所有新内容先进入收件箱，确认后才成为 MemoryEvent（#008）。
 * Asset 关系走 inbox_item_asset 关联表，不塞 JSON。
 */

const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAtColumn = () =>
  integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const inboxItem = sqliteTable(
  "inbox_item",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    // text | asset | bundle（多 asset 合并项，#010）
    kind: text("kind").notNull(),
    // new | processing | needs_review | confirmed | discarded
    status: text("status").notNull().default("new"),
    // kind=text 时的正文
    rawText: text("raw_text"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("inbox_family_status_idx").on(t.familyId, t.status),
    index("inbox_family_created_idx").on(t.familyId, t.createdAt),
  ],
);

export const inboxItemAsset = sqliteTable(
  "inbox_item_asset",
  {
    id: text("id").primaryKey(),
    inboxItemId: text("inbox_item_id")
      .notNull()
      .references(() => inboxItem.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    // 家庭冗余列：隔离查询免 join
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("inbox_item_asset_item_idx").on(t.inboxItemId),
    index("inbox_item_asset_asset_idx").on(t.assetId),
  ],
);
