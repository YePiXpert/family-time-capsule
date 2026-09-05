import "server-only";

import { randomUUID } from "node:crypto";
import { and, count, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { capsule } from "@/db/schema/capsule";
import { capsuleUnlockInstant } from "@/lib/capsules/service";
import { clusterSuggestion } from "@/db/schema/clusters";
import { contribution } from "@/db/schema/contribution";
import { family, person } from "@/db/schema/family";
import { importSession, importSessionItem } from "@/db/schema/import";
import { inboxItem } from "@/db/schema/inbox";
import { memoryEvent } from "@/db/schema/memory";
import { contributionPortalSubmission, contributionRequest } from "@/db/schema/oral-history";
import { reviewPeriod, reviewPeriodEvent, type ReviewPeriodRow } from "@/db/schema/review";
import { story } from "@/db/schema/story";
import { assertFamilyCapability } from "@/lib/authz/policy";
import type { FamilyContext } from "@/lib/family/context";
import { getTimelinePage } from "@/lib/memories/service";
import { zonedWallTimeToUtc } from "@/lib/metadata/time";
import { addCalendarDays, parseCalendarDate } from "@/mobile/src/utils/calendar";
import {
  collectStoryMaterial,
  collectTranscriptMaterial,
  createStoryDraft,
  planDeterministicDraft,
  type DraftParagraphPlan,
  type StoryPeriod,
} from "@/lib/stories/service";
import { enqueueAiJob, type AiJobServiceDependencies } from "@/lib/ai/jobs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function datePartsAt(instant: Date, timezone: string): { date: string; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const date = `${value("year")}-${value("month")}-${value("day")}`;
  return { date, weekday: new Date(`${date}T00:00:00Z`).getUTCDay() };
}

function shiftDate(date: string, days: number): string {
  if (!DATE_PATTERN.test(date)) throw new Error("invalid_review_date");
  const value = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== date) throw new Error("invalid_review_date");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export type ReviewWindow = StoryPeriod & { key: string; endDate: string };

/** Family-local calendar window. DST weeks may be 167/169 real hours. */
export function reviewWindowForDate(
  anchorDate: string,
  timezone: string,
  weekStartsOn: number,
): ReviewWindow {
  if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) throw new Error("invalid_week_start");
  const normalized = shiftDate(anchorDate, 0);
  const weekday = new Date(`${normalized}T00:00:00Z`).getUTCDay();
  const key = shiftDate(normalized, -((weekday - weekStartsOn + 7) % 7));
  const endDate = shiftDate(key, 7);
  return {
    key,
    endDate,
    start: zonedWallTimeToUtc(`${key}T00:00:00`, timezone),
    end: zonedWallTimeToUtc(`${endDate}T00:00:00`, timezone),
  };
}

export function reviewWindowForInstant(
  instant: Date,
  timezone: string,
  weekStartsOn: number,
): ReviewWindow {
  return reviewWindowForDate(datePartsAt(instant, timezone).date, timezone, weekStartsOn);
}

/** Next one-shot reminder inside this exact family-local review window. */
export function reviewReminderAt(
  window: ReviewWindow,
  timezone: string,
  reminderWeekday: number,
  reminderLocalTime: string,
  now: Date,
): Date | null {
  if (!Number.isInteger(reminderWeekday) || reminderWeekday < 0 || reminderWeekday > 6) return null;
  if (!TIME_PATTERN.test(reminderLocalTime)) return null;
  const startWeekday = new Date(`${window.key}T00:00:00Z`).getUTCDay();
  const reminderDate = shiftDate(window.key, (reminderWeekday - startWeekday + 7) % 7);
  let candidate: Date;
  try {
    candidate = zonedWallTimeToUtc(`${reminderDate}T${reminderLocalTime}:00`, timezone);
  } catch {
    return null;
  }
  return candidate > now && candidate < window.end ? candidate : null;
}

async function familyReviewConfig(familyId: string) {
  return (await getDb().select().from(family).where(eq(family.id, familyId)).limit(1))[0] ?? null;
}

export async function getOrCreateReviewPeriod(
  context: FamilyContext,
  input: { now?: Date; anchorDate?: string } = {},
): Promise<{ period: ReviewPeriodRow; window: ReviewWindow }> {
  assertFamilyCapability(context.role, "archive:view");
  const config = await familyReviewConfig(context.familyId);
  if (!config) throw new Error("family_not_found");
  const window = input.anchorDate
    ? reviewWindowForDate(input.anchorDate, config.timezone, config.weekStartsOn)
    : reviewWindowForInstant(input.now ?? new Date(), config.timezone, config.weekStartsOn);
  return ensureReviewPeriod(context, window, input.now ?? new Date());
}

function ensureReviewPeriod(context: FamilyContext, window: ReviewWindow, now: Date) {
  const db = getDb();
  db.insert(reviewPeriod).values({
    id: randomUUID(), familyId: context.familyId, periodStart: window.start, periodEnd: window.end,
    status: "open", createdAt: now, updatedAt: now,
  }).onConflictDoNothing().run();
  const period = db.select().from(reviewPeriod).where(and(
    eq(reviewPeriod.familyId, context.familyId), eq(reviewPeriod.periodStart, window.start), eq(reviewPeriod.periodEnd, window.end),
  )).get();
  if (!period) throw new Error("review_period_unavailable");
  return {period, window};
}

/** Month/year/custom reviews use the same persisted period and highlight relations. */
export function getOrCreateRangeReviewPeriod(context: FamilyContext, startDate: string, endDate: string) {
  assertFamilyCapability(context.role, "archive:view");
  parseCalendarDate(startDate); parseCalendarDate(endDate);
  if (endDate < startDate) throw new Error("invalid_review_date");
  const before = addCalendarDays(endDate, 1);
  return ensureReviewPeriod(context, {
    key: startDate, endDate: before,
    start: zonedWallTimeToUtc(`${startDate}T00:00:00`, context.familyTimezone),
    end: zonedWallTimeToUtc(`${before}T00:00:00`, context.familyTimezone),
  }, new Date());
}

export type ReviewPreferences = {
  timezone: string;
  weekStartsOn: number;
  reminderWeekday: number;
  reminderLocalTime: string;
  remindPendingInbox: boolean;
  remindPendingRequests: boolean;
  remindUpcomingCapsules: boolean;
};

export async function updateReviewPreferences(
  context: FamilyContext,
  input: Omit<ReviewPreferences, "timezone">,
): Promise<{ ok: true } | { ok: false; error: "invalid" }> {
  assertFamilyCapability(context.role, "family:manage");
  if (
    !Number.isInteger(input.weekStartsOn) || input.weekStartsOn < 0 || input.weekStartsOn > 6 ||
    !Number.isInteger(input.reminderWeekday) || input.reminderWeekday < 0 || input.reminderWeekday > 6 ||
    !TIME_PATTERN.test(input.reminderLocalTime)
  ) return { ok: false, error: "invalid" };
  await getDb().update(family).set({
    weekStartsOn: input.weekStartsOn,
    reviewReminderWeekday: input.reminderWeekday,
    reviewReminderLocalTime: input.reminderLocalTime,
    remindPendingInbox: input.remindPendingInbox,
    remindPendingRequests: input.remindPendingRequests,
    remindUpcomingCapsules: input.remindUpcomingCapsules,
    updatedAt: new Date(),
  }).where(eq(family.id, context.familyId));
  return { ok: true };
}

export async function setReviewProgress(
  context: FamilyContext,
  reviewId: string,
  operation: "start" | "complete" | "reopen",
): Promise<{ ok: true } | { ok: false; error: "not_found" | "invalid_state" }> {
  assertFamilyCapability(context.role, "story:write");
  const current = (await getDb().select().from(reviewPeriod).where(and(
    eq(reviewPeriod.familyId, context.familyId), eq(reviewPeriod.id, reviewId),
  )).limit(1))[0];
  if (!current) return { ok: false, error: "not_found" };
  const now = new Date();
  if (operation === "start") {
    if (current.status !== "open") return { ok: true };
    await getDb().update(reviewPeriod).set({ status: "in_progress", startedAt: now, updatedAt: now }).where(eq(reviewPeriod.id, reviewId));
  } else if (operation === "complete") {
    if (current.status === "completed") return { ok: true };
    await getDb().update(reviewPeriod).set({ status: "completed", startedAt: current.startedAt ?? now, completedAt: now, updatedAt: now }).where(eq(reviewPeriod.id, reviewId));
  } else {
    if (current.status !== "completed") return { ok: true };
    await getDb().update(reviewPeriod).set({ status: "in_progress", completedAt: null, updatedAt: now }).where(eq(reviewPeriod.id, reviewId));
  }
  return { ok: true };
}

export async function setReviewHighlight(
  context: FamilyContext,
  reviewId: string,
  eventId: string,
  selected: boolean,
): Promise<{ ok: true } | { ok: false; error: "not_found" | "outside_period" }> {
  assertFamilyCapability(context.role, "story:write");
  const period = (await getDb().select().from(reviewPeriod).where(and(
    eq(reviewPeriod.familyId, context.familyId), eq(reviewPeriod.id, reviewId),
  )).limit(1))[0];
  if (!period) return { ok: false, error: "not_found" };
  const event = (await getDb().select({ id: memoryEvent.id }).from(memoryEvent).where(and(
    eq(memoryEvent.familyId, context.familyId),
    eq(memoryEvent.id, eventId),
    eq(memoryEvent.status, "confirmed"),
    isNull(memoryEvent.deletedAt),
    gte(memoryEvent.occurredAt, period.periodStart),
    lt(memoryEvent.occurredAt, period.periodEnd),
  )).limit(1))[0];
  if (!event) return { ok: false, error: "outside_period" };
  if (selected) {
    await getDb().insert(reviewPeriodEvent).values({
      id: randomUUID(), familyId: context.familyId, reviewPeriodId: reviewId,
      memoryEventId: eventId, selectedByUserId: context.userId, createdAt: new Date(),
    }).onConflictDoNothing().run();
  } else {
    await getDb().delete(reviewPeriodEvent).where(and(
      eq(reviewPeriodEvent.familyId, context.familyId),
      eq(reviewPeriodEvent.reviewPeriodId, reviewId),
      eq(reviewPeriodEvent.memoryEventId, eventId),
    ));
  }
  if (period.status === "open") await setReviewProgress(context, reviewId, "start");
  return { ok: true };
}

export type ReviewOverview = {
  period: ReviewPeriodRow;
  key: string;
  preferences: ReviewPreferences;
  counts: {
    inbox: number;
    needsReview: number;
    duplicateSuggestions: number;
    clusterSuggestions: number;
    guestSubmissions: number;
    failedImports: number;
    pendingRequests: number;
    upcomingCapsules: number;
  };
  events: Array<{
    id: string;
    title: string;
    occurredAt: Date;
    locationText: string | null;
    participantNames: string[];
    milestoneType: string | null;
    contributionCount: number;
    selected: boolean;
  }>;
  reminderAt: Date | null;
};

export async function getReviewOverview(
  context: FamilyContext,
  anchorDate?: string,
  options: { now?: Date } = {},
): Promise<ReviewOverview> {
  const now = options.now ?? new Date();
  const { period, window } = await getOrCreateReviewPeriod(context, { anchorDate, now });
  const config = await familyReviewConfig(context.familyId);
  if (!config) throw new Error("family_not_found");
  const [timeline, selectedRows, inboxCounts, clusters, guest, failed, pendingRequests, sealedCapsules, child] = await Promise.all([
    getTimelinePage(context.familyId, { occurredFrom: period.periodStart, occurredBefore: period.periodEnd, limit: 50 }),
    getDb().select({ eventId: reviewPeriodEvent.memoryEventId }).from(reviewPeriodEvent).where(and(
      eq(reviewPeriodEvent.familyId, context.familyId), eq(reviewPeriodEvent.reviewPeriodId, period.id),
    )),
    getDb().select({
      total: sql<number>`sum(case when ${inboxItem.status} in ('new','processing','needs_review') then 1 else 0 end)`,
      needsReview: sql<number>`sum(case when ${inboxItem.status} = 'needs_review' then 1 else 0 end)`,
    }).from(inboxItem).where(eq(inboxItem.familyId, context.familyId)),
    getDb().select({ kind: clusterSuggestion.kind, value: count() }).from(clusterSuggestion).where(and(
      eq(clusterSuggestion.familyId, context.familyId), eq(clusterSuggestion.status, "pending"),
    )).groupBy(clusterSuggestion.kind),
    getDb().select({ value: count() }).from(contributionPortalSubmission).where(and(
      eq(contributionPortalSubmission.familyId, context.familyId),
      gte(contributionPortalSubmission.createdAt, period.periodStart),
      lt(contributionPortalSubmission.createdAt, period.periodEnd),
    )),
    getDb().select({ value: count() }).from(importSessionItem).innerJoin(importSession, eq(importSession.id, importSessionItem.importSessionId)).where(and(
      eq(importSession.familyId, context.familyId), eq(importSessionItem.familyId, context.familyId), eq(importSessionItem.status, "failed"),
    )),
    getDb().select({ value: count() }).from(contributionRequest).where(and(
      eq(contributionRequest.familyId, context.familyId), eq(contributionRequest.kind, "request"), eq(contributionRequest.status, "open"),
    )),
    getDb().select({ unlockType: capsule.unlockType, unlockValue: capsule.unlockValue }).from(capsule).where(and(
      eq(capsule.familyId, context.familyId), eq(capsule.status, "sealed"),
    )),
    getDb().select({ birthDate: person.birthDate }).from(person).where(and(
      eq(person.familyId, context.familyId), eq(person.isChild, true),
    )).limit(1),
  ]);
  const eventIds = timeline.entries.map((entry) => entry.event.id);
  const contributionCounts = eventIds.length ? await getDb().select({
    eventId: contribution.memoryEventId, value: count(),
  }).from(contribution).where(and(
    inArray(contribution.memoryEventId, eventIds),
    eq(contribution.visibility, "family"),
    isNull(contribution.deletedAt),
  )).groupBy(contribution.memoryEventId) : [];
  const countByEvent = new Map(contributionCounts.map((row) => [row.eventId, Number(row.value)]));
  const selected = new Set(selectedRows.map((row) => row.eventId));
  const clusterCount = (kind: string) => Number(clusters.find((row) => row.kind === kind)?.value ?? 0);
  return {
    period,
    key: window.key,
    preferences: {
      timezone: config.timezone,
      weekStartsOn: config.weekStartsOn,
      reminderWeekday: config.reviewReminderWeekday,
      reminderLocalTime: config.reviewReminderLocalTime,
      remindPendingInbox: config.remindPendingInbox,
      remindPendingRequests: config.remindPendingRequests,
      remindUpcomingCapsules: config.remindUpcomingCapsules,
    },
    counts: {
      inbox: Number(inboxCounts[0]?.total ?? 0),
      needsReview: Number(inboxCounts[0]?.needsReview ?? 0),
      duplicateSuggestions: clusterCount("similar_media") + clusterCount("live_photo_pair"),
      clusterSuggestions: clusters.reduce((sum, row) => sum + Number(row.value), 0),
      guestSubmissions: Number(guest[0]?.value ?? 0),
      failedImports: Number(failed[0]?.value ?? 0),
      pendingRequests: Number(pendingRequests[0]?.value ?? 0),
      upcomingCapsules: sealedCapsules.filter((row) => {
        const unlockAt = capsuleUnlockInstant(row, child[0]?.birthDate ?? null, config.timezone);
        return unlockAt !== null && unlockAt >= now && unlockAt < period.periodEnd;
      }).length,
    },
    events: timeline.entries.map((entry) => ({
      id: entry.event.id,
      title: entry.event.title,
      occurredAt: entry.event.occurredAt,
      locationText: entry.event.locationText,
      participantNames: entry.participantNames,
      milestoneType: entry.event.milestoneType,
      contributionCount: countByEvent.get(entry.event.id) ?? 0,
      selected: selected.has(entry.event.id),
    })),
    reminderAt: reviewReminderAt(
      window,
      config.timezone,
      config.reviewReminderWeekday,
      config.reviewReminderLocalTime,
      now,
    ),
  };
}

export async function generateReviewStory(
  context: FamilyContext,
  reviewId: string,
): Promise<{ ok: true; storyId: string; existing: boolean } | { ok: false; error: "not_found" | "no_events" }> {
  assertFamilyCapability(context.role, "story:write");
  const period = (await getDb().select().from(reviewPeriod).where(and(
    eq(reviewPeriod.familyId, context.familyId), eq(reviewPeriod.id, reviewId),
  )).limit(1))[0];
  if (!period) return { ok: false, error: "not_found" };
  if (period.storyId) {
    const existing = (await getDb().select({ id: story.id }).from(story).where(and(
      eq(story.familyId, context.familyId), eq(story.id, period.storyId), isNull(story.deletedAt),
    )).limit(1))[0];
    if (existing) return { ok: true, storyId: existing.id, existing: true };
  }
  const selected = await getDb().select({ eventId: reviewPeriodEvent.memoryEventId }).from(reviewPeriodEvent).where(and(
    eq(reviewPeriodEvent.familyId, context.familyId), eq(reviewPeriodEvent.reviewPeriodId, reviewId),
  ));
  const timeline = await getTimelinePage(context.familyId, {
    occurredFrom: period.periodStart, occurredBefore: period.periodEnd, limit: 50,
  });
  const chosen = selected.length
    ? timeline.entries.filter((entry) => selected.some((row) => row.eventId === entry.event.id))
    : timeline.entries;
  if (chosen.length === 0) return { ok: false, error: "no_events" };
  const eventIds = new Set(chosen.map((entry) => entry.event.id));
  const formatter = new Intl.DateTimeFormat("zh-CN", { timeZone: context.familyTimezone, month: "long", day: "numeric" });
  const eventPlans: DraftParagraphPlan[] = [...chosen].reverse().map((entry) => ({
    kind: "narrative",
    text: `${formatter.format(entry.event.occurredAt)} · ${entry.event.title} · 人物：${entry.participantNames.join("、") || "未标注"}${entry.event.locationText ? ` · 地点：${entry.event.locationText}` : ""}`,
    sources: [{ sourceType: "memory_event", sourceId: entry.event.id, quote: null }],
  }));
  const storyPeriod = { start: period.periodStart, end: period.periodEnd };
  const material = collectStoryMaterial(context.familyId, storyPeriod);
  material.facts = material.facts.filter((entry) => eventIds.has(entry.eventId));
  material.contributions = material.contributions.filter((entry) => eventIds.has(entry.eventId));
  const transcripts = collectTranscriptMaterial(context.familyId, storyPeriod).filter((entry) => eventIds.has(entry.eventId));
  const sourceEvent = new Map<string, string>();
  material.facts.forEach((entry) => sourceEvent.set(entry.factId, entry.eventId));
  material.contributions.forEach((entry) => sourceEvent.set(entry.contributionId, entry.eventId));
  transcripts.forEach((entry) => sourceEvent.set(entry.transcriptId, entry.eventId));
  const voicePlans = planDeterministicDraft(material, transcripts).map((plan) => {
    const eventSources = [...new Set(
      plan.sources.map((source) => sourceEvent.get(source.sourceId)).filter((id): id is string => Boolean(id)),
    )].map((eventId) => ({ sourceType: "memory_event" as const, sourceId: eventId, quote: null }));
    return { ...plan, sources: [...plan.sources, ...eventSources] };
  });
  return getDb().transaction((tx) => {
    const current = tx.select().from(reviewPeriod).where(and(
      eq(reviewPeriod.id, reviewId), eq(reviewPeriod.familyId, context.familyId),
    )).get();
    if (!current) return { ok: false as const, error: "not_found" as const };
    if (current.storyId) {
      const existing = tx.select({ id: story.id }).from(story).where(and(
        eq(story.id, current.storyId), eq(story.familyId, context.familyId), isNull(story.deletedAt),
      )).get();
      if (existing) return { ok: true as const, storyId: existing.id, existing: true };
    }
    // The nested draft transaction is a savepoint on this same connection.
    // Story, sources and period ownership commit together, including replacement
    // of a soft-deleted draft; a crash cannot leave an unclaimed new story.
    const created = createStoryDraft(context, {
      kind: "weekly",
      anchor: period.periodStart,
      period: storyPeriod,
      title: `${formatter.format(period.periodStart)}这一周的家庭周记`,
    }, [...eventPlans, ...voicePlans]);
    if (!created.ok) return { ok: false as const, error: "no_events" as const };
    tx.update(reviewPeriod).set({ storyId: created.storyId, status: "in_progress", startedAt: current.startedAt ?? new Date(), updatedAt: new Date() })
      .where(eq(reviewPeriod.id, reviewId)).run();
    return { ok: true as const, storyId: created.storyId, existing: false };
  }, { behavior: "immediate" });
}

export type ReviewStoryOptimizationResult =
  | { ok: true; storyId: string; jobId: string; created: boolean }
  | { ok: false; error: string };

/**
 * Explicit, consent-gated AI refinement. A deterministic source-linked draft
 * is created first, so no provider is ever required for the weekly ritual.
 */
export async function requestReviewStoryOptimization(
  context: FamilyContext,
  reviewId: string,
  options: AiJobServiceDependencies & { now?: Date } = {},
): Promise<ReviewStoryOptimizationResult> {
  assertFamilyCapability(context.role, "ai:review");
  const generated = await generateReviewStory(context, reviewId);
  if (!generated.ok) return generated;
  const period = (await getDb().select().from(reviewPeriod).where(and(
    eq(reviewPeriod.familyId, context.familyId), eq(reviewPeriod.id, reviewId),
  )).limit(1))[0];
  if (!period) return { ok: false, error: "not_found" };
  const selected = await getDb().select({ id: reviewPeriodEvent.memoryEventId }).from(reviewPeriodEvent).where(and(
    eq(reviewPeriodEvent.familyId, context.familyId), eq(reviewPeriodEvent.reviewPeriodId, reviewId),
  ));
  const sourceIds = selected.length ? selected.map((row) => row.id) : (await getTimelinePage(context.familyId, {
    occurredFrom: period.periodStart, occurredBefore: period.periodEnd, limit: 50,
  })).entries.map((entry) => entry.event.id);
  const queued = enqueueAiJob({
    familyId: context.familyId,
    requestedByUserId: context.userId,
    jobType: "optimize.review_story.v1",
    entityType: "review_period",
    entityId: reviewId,
    requiredCapability: "text",
    triggerMode: "manual",
    sources: sourceIds.map((id) => ({ kind: "memory_event", id })),
  }, options);
  return queued.ok
    ? { ok: true, storyId: generated.storyId, jobId: queued.jobId, created: queued.created }
    : queued;
}
