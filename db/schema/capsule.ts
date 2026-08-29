import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { asset } from "./asset";
import { contribution } from "./contribution";
import { family } from "./family";
import { memoryEvent } from "./memory";

/**
 * 时间胶囊（Issue #013，PRD §15）。
 * 封存首先是仪式感：seal 后普通 UI 不显示正文，但**不是物理加密**——
 * 管理员备份/导出（#014）始终完整包含，不存在无法恢复的数据。
 */

const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAtColumn = () =>
  integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const capsule = sqliteTable(
  "capsule",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // date: unlockValue=YYYY-MM-DD；age: unlockValue=年数（字符串存储）
    unlockType: text("unlock_type").notNull(),
    unlockValue: text("unlock_value").notNull(),
    // draft | sealed | opened
    status: text("status").notNull().default("draft"),
    sealedAt: integer("sealed_at", { mode: "timestamp" }),
    openedAt: integer("opened_at", { mode: "timestamp" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index("capsule_family_idx").on(t.familyId, t.status)],
);

export const capsuleAsset = sqliteTable(
  "capsule_asset",
  {
    id: text("id").primaryKey(),
    capsuleId: text("capsule_id")
      .notNull()
      .references(() => capsule.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (t) => [index("capsule_asset_capsule_idx").on(t.capsuleId)],
);

export const capsuleEvent = sqliteTable(
  "capsule_event",
  {
    id: text("id").primaryKey(),
    capsuleId: text("capsule_id")
      .notNull()
      .references(() => capsule.id, { onDelete: "cascade" }),
    memoryEventId: text("memory_event_id")
      .notNull()
      .references(() => memoryEvent.id, { onDelete: "cascade" }),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (t) => [index("capsule_event_capsule_idx").on(t.capsuleId)],
);

export const capsuleContribution = sqliteTable(
  "capsule_contribution",
  {
    id: text("id").primaryKey(),
    capsuleId: text("capsule_id")
      .notNull()
      .references(() => capsule.id, { onDelete: "cascade" }),
    contributionId: text("contribution_id")
      .notNull()
      .references(() => contribution.id, { onDelete: "cascade" }),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (t) => [index("capsule_contribution_capsule_idx").on(t.capsuleId)],
);
