import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { family } from "./family";
import { memoryEvent } from "./memory";
import { fact } from "./contribution";

/**
 * AI Suggestion + Fact Source + MemoryEvent Tag（Issue #M3-C）。
 *
 * - ai_suggestion 是运维/可重建状态：只保存当前待审建议与接受/拒绝墓碑，不进入 portable archive。
 * - fact_source 是耐久家庭资料：每条 fact（含手工创建）必须有来源，导出/恢复必须保留。
 * - memory_event_tag 是耐久家庭资料：事件标签，导出/恢复必须保留。
 */

const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const aiSuggestion = sqliteTable(
  "ai_suggestion",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    suggestionType: text("suggestion_type").notNull(),
    valueJson: text("value_json").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull().default("pending"),
    createdByJobId: text("created_by_job_id"),
    sourceFingerprint: text("source_fingerprint").notNull(),
    createdAt: createdAtColumn(),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    resolvedByUserId: text("resolved_by_user_id"),
  },
  (t) => [
    index("ai_suggestion_family_idx").on(t.familyId),
    index("ai_suggestion_entity_status_idx").on(t.entityType, t.entityId, t.status),
    check(
      "ai_suggestion_entity_type_check",
      sql`${t.entityType} in ('memory_event')`,
    ),
    check(
      "ai_suggestion_type_check",
      sql`${t.suggestionType} in ('title', 'location', 'person', 'tag')`,
    ),
    check(
      "ai_suggestion_status_check",
      sql`${t.status} in ('pending', 'accepted', 'rejected')`,
    ),
  ],
);

export const factSource = sqliteTable(
  "fact_source",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    factId: text("fact_id")
      .notNull()
      .references(() => fact.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("fact_source_fact_idx").on(t.factId),
    index("fact_source_family_idx").on(t.familyId),
    check(
      "fact_source_type_check",
      sql`${t.sourceType} in ('asset', 'contribution', 'transcript', 'user_text')`,
    ),
  ],
);

export const memoryEventTag = sqliteTable(
  "memory_event_tag",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    memoryEventId: text("memory_event_id")
      .notNull()
      .references(() => memoryEvent.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("memory_event_tag_event_tag_uidx").on(t.memoryEventId, t.tag),
    index("memory_event_tag_family_idx").on(t.familyId, t.tag),
  ],
);

export type AiSuggestionRow = typeof aiSuggestion.$inferSelect;
export type FactSourceRow = typeof factSource.$inferSelect;
export type MemoryEventTagRow = typeof memoryEventTag.$inferSelect;
