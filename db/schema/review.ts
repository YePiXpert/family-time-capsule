import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { family } from "./family";
import { memoryEvent } from "./memory";
import { story } from "./story";

const createdAtColumn = () => integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date());
const updatedAtColumn = () => integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date());

export const reviewPeriod = sqliteTable("review_period", {
  id: text("id").primaryKey(),
  familyId: text("family_id").notNull().references(() => family.id, { onDelete: "cascade" }),
  periodStart: integer("period_start", { mode: "timestamp" }).notNull(),
  periodEnd: integer("period_end", { mode: "timestamp" }).notNull(),
  status: text("status").notNull().default("open"),
  storyId: text("story_id").references(() => story.id, { onDelete: "set null" }),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
}, (t) => [
  uniqueIndex("review_period_family_window_uidx").on(t.familyId, t.periodStart, t.periodEnd),
  index("review_period_family_status_idx").on(t.familyId, t.status, t.periodStart),
  check("review_period_status_check", sql`${t.status} in ('open', 'in_progress', 'completed')`),
  check("review_period_window_check", sql`${t.periodEnd} > ${t.periodStart}`),
]);

export const reviewPeriodEvent = sqliteTable("review_period_event", {
  id: text("id").primaryKey(),
  familyId: text("family_id").notNull().references(() => family.id, { onDelete: "cascade" }),
  reviewPeriodId: text("review_period_id").notNull().references(() => reviewPeriod.id, { onDelete: "cascade" }),
  memoryEventId: text("memory_event_id").notNull().references(() => memoryEvent.id, { onDelete: "cascade" }),
  selectedByUserId: text("selected_by_user_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: createdAtColumn(),
}, (t) => [
  uniqueIndex("review_period_event_uidx").on(t.reviewPeriodId, t.memoryEventId),
  index("review_period_event_family_idx").on(t.familyId, t.reviewPeriodId),
]);

export type ReviewPeriodRow = typeof reviewPeriod.$inferSelect;
export type ReviewPeriodEventRow = typeof reviewPeriodEvent.$inferSelect;
