import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { aiSuggestion, memoryEventTag } from "@/db/schema/suggestion";
import { memoryEvent, memoryEventParticipant } from "@/db/schema/memory";
import { person as personTable } from "@/db/schema/family";
import { inboxItem, inboxItemAsset } from "@/db/schema/inbox";
import { asset as assetTable } from "@/db/schema/asset";
import { aiJob } from "@/db/schema/ai-job";
import { assertFamilyCapability } from "@/lib/authz/policy";
import { enqueueAiJob, type AiJobServiceDependencies } from "@/lib/ai/jobs";
import { updateMemoryEvent } from "@/lib/memories/service";
import type { FamilyContext } from "@/lib/family/context";
import type { AiSuggestionRow } from "@/db/schema/suggestion";

export type SuggestionRequestResult =
  | { ok: true; jobId: string; created: boolean }
  | { ok: false; error: string };

export type ResolveSuggestionResult =
  | { ok: true }
  | { ok: false; error: string };

function normalizeTag(tag: string): string | null {
  const trimmed = tag.trim().toLowerCase();
  if (trimmed.length < 1 || trimmed.length > 50) return null;
  return trimmed;
}

export async function listPendingSuggestions(
  familyId: string,
  entityType: string,
  entityId: string,
): Promise<AiSuggestionRow[]> {
  return getDb()
    .select()
    .from(aiSuggestion)
    .where(
      and(
        eq(aiSuggestion.familyId, familyId),
        eq(aiSuggestion.entityType, entityType),
        eq(aiSuggestion.entityId, entityId),
        eq(aiSuggestion.status, "pending"),
      ),
    )
    .orderBy(aiSuggestion.createdAt);
}

export function requestEventSuggestions(
  context: FamilyContext,
  memoryEventId: string,
  options: AiJobServiceDependencies & { now?: Date } = {},
): SuggestionRequestResult {
  try {
    assertFamilyCapability(context.role, "ai:review");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const event = getDb()
    .select({ id: memoryEvent.id })
    .from(memoryEvent)
    .where(
      and(
        eq(memoryEvent.id, memoryEventId),
        eq(memoryEvent.familyId, context.familyId),
      ),
    )
    .limit(1)
    .get();
  if (!event) {
    return { ok: false, error: "event_not_found" };
  }

  return enqueueAiJob(
    {
      familyId: context.familyId,
      requestedByUserId: context.userId,
      jobType: "suggest.event_metadata.v1",
      entityType: "memory_event",
      entityId: memoryEventId,
      requiredCapability: "text",
      triggerMode: "manual",
      sources: [{ kind: "memory_event", id: memoryEventId }],
    },
    options,
  );
}

export async function resolveSuggestion(
  familyId: string,
  userId: string,
  suggestionId: string,
  action: "accept" | "reject",
  editedValue?: string,
): Promise<ResolveSuggestionResult> {
  const db = getDb();
  const suggestion = await db
    .select()
    .from(aiSuggestion)
    .where(
      and(eq(aiSuggestion.id, suggestionId), eq(aiSuggestion.familyId, familyId)),
    )
    .limit(1)
    .get();
  if (!suggestion) {
    return { ok: false, error: "not_found" };
  }
  if (suggestion.status !== "pending") {
    return { ok: false, error: "already_resolved" };
  }
  if (suggestion.entityType !== "memory_event") {
    return { ok: false, error: "invalid_entity" };
  }

  const now = new Date();

  if (action === "reject") {
    await db
      .update(aiSuggestion)
      .set({
        status: "rejected",
        resolvedAt: now,
        resolvedByUserId: userId,
      })
      .where(eq(aiSuggestion.id, suggestionId))
      .run();
    return { ok: true };
  }

  // accept
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(suggestion.valueJson);
  } catch {
    return { ok: false, error: "invalid_payload" };
  }

  switch (suggestion.suggestionType) {
    case "title": {
      const title = (editedValue ?? (payload.title as string) ?? "").trim();
      const result = await updateMemoryEvent(
        familyId,
        suggestion.entityId,
        userId,
        { title },
      );
      if (!result.ok) {
        return {
          ok: false,
          error:
            result.error === "not_found"
              ? "event_not_found"
              : "invalid_title",
        };
      }
      break;
    }
    case "location": {
      const locationText = (
        editedValue ??
        (payload.locationText as string) ??
        ""
      ).trim();
      const result = await updateMemoryEvent(
        familyId,
        suggestion.entityId,
        userId,
        { locationText: locationText || null },
      );
      if (!result.ok) {
        return {
          ok: false,
          error:
            result.error === "not_found"
              ? "event_not_found"
              : "invalid_location",
        };
      }
      break;
    }
    case "occurred_at": {
      // M3-E：只建议 MemoryEvent.occurredAt；Asset.capturedAt/importedAt 永不因此改变。
      // 接受即修改事件时间 → 时间轴自动重排、child age 重算（updateMemoryEvent 走修订快照）。
      const raw = (editedValue ?? (payload.occurredAt as string) ?? "").trim();
      if (!raw) return { ok: false, error: "invalid_time" };
      const occurredAt = new Date(raw);
      if (Number.isNaN(occurredAt.getTime())) {
        return { ok: false, error: "invalid_time" };
      }
      const precisionRaw = payload.precision;
      const occurredAtPrecision =
        precisionRaw === "exact" || precisionRaw === "approximate" || precisionRaw === "date_only"
          ? precisionRaw
          : "approximate";
      const result = await updateMemoryEvent(
        familyId,
        suggestion.entityId,
        userId,
        { occurredAt, occurredAtPrecision },
      );
      if (!result.ok) {
        return {
          ok: false,
          error: result.error === "not_found" ? "event_not_found" : "invalid_time",
        };
      }
      break;
    }
    case "person": {
      const personId = payload.personId as string;
      if (!personId) {
        return { ok: false, error: "invalid_payload" };
      }
      const person = await db
        .select({ id: personTable.id })
        .from(personTable)
        .where(
          and(
            eq(personTable.id, personId),
            eq(personTable.familyId, familyId),
          ),
        )
        .limit(1)
        .get();
      if (!person) {
        return { ok: false, error: "person_not_found" };
      }
      const existing = await db
        .select({ id: memoryEventParticipant.id })
        .from(memoryEventParticipant)
        .where(
          and(
            eq(memoryEventParticipant.memoryEventId, suggestion.entityId),
            eq(memoryEventParticipant.personId, personId),
          ),
        )
        .limit(1)
        .get();
      if (!existing) {
        await db
          .insert(memoryEventParticipant)
          .values({
            id: randomUUID(),
            memoryEventId: suggestion.entityId,
            personId,
            familyId,
            createdAt: now,
          })
          .run();
      }
      break;
    }
    case "tag": {
      const rawTag = editedValue ?? (payload.tag as string) ?? "";
      const tag = normalizeTag(rawTag);
      if (!tag) {
        return { ok: false, error: "invalid_tag" };
      }
      const existing = await db
        .select({ id: memoryEventTag.id })
        .from(memoryEventTag)
        .where(
          and(
            eq(memoryEventTag.memoryEventId, suggestion.entityId),
            eq(memoryEventTag.tag, tag),
          ),
        )
        .limit(1)
        .get();
      if (!existing) {
        await db
          .insert(memoryEventTag)
          .values({
            id: randomUUID(),
            memoryEventId: suggestion.entityId,
            familyId,
            tag,
            createdAt: now,
          })
          .run();
      }
      break;
    }
    default:
      return { ok: false, error: "invalid_type" };
  }

  await db
    .update(aiSuggestion)
    .set({
      status: "accepted",
      resolvedAt: now,
      resolvedByUserId: userId,
    })
    .where(eq(aiSuggestion.id, suggestionId))
    .run();

  return { ok: true };
}

export async function listEventTags(
  familyId: string,
  memoryEventId: string,
): Promise<string[]> {
  const rows = await getDb()
    .select({ tag: memoryEventTag.tag })
    .from(memoryEventTag)
    .where(
      and(
        eq(memoryEventTag.familyId, familyId),
        eq(memoryEventTag.memoryEventId, memoryEventId),
      ),
    )
    .orderBy(memoryEventTag.tag);
  return rows.map((r) => r.tag);
}

const BATCH_CAP = 20;

export function requestInboxItemSuggestions(
  context: FamilyContext,
  inboxItemId: string,
  options: AiJobServiceDependencies & { now?: Date } = {},
): SuggestionRequestResult {
  try {
    assertFamilyCapability(context.role, "ai:review");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const db = getDb();
  const item = db
    .select({ id: inboxItem.id, status: inboxItem.status })
    .from(inboxItem)
    .where(
      and(
        eq(inboxItem.id, inboxItemId),
        eq(inboxItem.familyId, context.familyId),
      ),
    )
    .get();
  if (!item) return { ok: false, error: "inbox_item_not_found" };
  if (!["new", "needs_review", "processing"].includes(item.status)) {
    return { ok: false, error: "inbox_item_closed" };
  }

  const links = db
    .select({ assetId: inboxItemAsset.assetId })
    .from(inboxItemAsset)
    .where(eq(inboxItemAsset.inboxItemId, inboxItemId))
    .all();
  const assetIds = links.map((l) => l.assetId);

  const originalAssetIds =
    assetIds.length > 0
      ? db
          .select({ id: assetTable.id })
          .from(assetTable)
          .where(
            and(
              eq(assetTable.familyId, context.familyId),
              inArray(assetTable.id, assetIds),
              isNull(assetTable.originalAssetId),
            ),
          )
          .all()
          .map((r) => r.id)
      : [];

  if (originalAssetIds.length === 0) {
    return { ok: false, error: "inbox_item_has_no_assets" };
  }

  return enqueueAiJob(
    {
      familyId: context.familyId,
      requestedByUserId: context.userId,
      jobType: "suggest.inbox_item.v1",
      entityType: "inbox_item",
      entityId: inboxItemId,
      requiredCapability: "text",
      triggerMode: "manual",
      sources: originalAssetIds.map((id) => ({ kind: "asset", id })),
    },
    options,
  );
}

export type InboxBatchResult = {
  requested: number;
  skipped: number;
};

export function requestInboxSuggestionsBatch(
  context: FamilyContext,
  options: AiJobServiceDependencies & { now?: Date } = {},
): InboxBatchResult {
  try {
    assertFamilyCapability(context.role, "ai:review");
  } catch {
    return { requested: 0, skipped: 0 };
  }

  const db = getDb();
  const openItems = db
    .select({ id: inboxItem.id })
    .from(inboxItem)
    .where(
      and(
        eq(inboxItem.familyId, context.familyId),
        inArray(inboxItem.status, ["new", "needs_review", "processing"]),
        inArray(inboxItem.kind, ["asset", "bundle"]),
      ),
    )
    .limit(BATCH_CAP * 4)
    .all();

  let requested = 0;
  let skipped = 0;
  for (const item of openItems.slice(0, BATCH_CAP * 2)) {
    if (requested >= BATCH_CAP) break;

    const hasPendingSuggestion = db
      .select({ id: aiSuggestion.id })
      .from(aiSuggestion)
      .where(
        and(
          eq(aiSuggestion.familyId, context.familyId),
          eq(aiSuggestion.entityType, "inbox_item"),
          eq(aiSuggestion.entityId, item.id),
          eq(aiSuggestion.status, "pending"),
        ),
      )
      .get();
    if (hasPendingSuggestion) {
      skipped++;
      continue;
    }

    const hasActiveJob = db
      .select({ id: aiJob.id })
      .from(aiJob)
      .where(
        and(
          eq(aiJob.familyId, context.familyId),
          eq(aiJob.entityType, "inbox_item"),
          eq(aiJob.entityId, item.id),
          eq(aiJob.jobType, "suggest.inbox_item.v1"),
          inArray(aiJob.status, ["pending", "running"]),
        ),
      )
      .get();
    if (hasActiveJob) {
      skipped++;
      continue;
    }

    const result = requestInboxItemSuggestions(context, item.id, options);
    if (result.ok) {
      requested++;
    } else {
      skipped++;
    }
  }

  return { requested, skipped };
}

export async function resolveInboxSuggestion(
  familyId: string,
  userId: string,
  suggestionId: string,
  action: "accept" | "reject",
  editedValue?: string,
): Promise<ResolveSuggestionResult> {
  const db = getDb();
  const suggestion = await db
    .select()
    .from(aiSuggestion)
    .where(
      and(eq(aiSuggestion.id, suggestionId), eq(aiSuggestion.familyId, familyId)),
    )
    .limit(1)
    .get();
  if (!suggestion) return { ok: false, error: "not_found" };
  if (suggestion.status !== "pending") return { ok: false, error: "already_resolved" };
  if (suggestion.entityType !== "inbox_item") return { ok: false, error: "invalid_entity" };

  const now = new Date();

  if (action === "reject") {
    await db
      .update(aiSuggestion)
      .set({
        status: "rejected",
        resolvedAt: now,
        resolvedByUserId: userId,
      })
      .where(eq(aiSuggestion.id, suggestionId))
      .run();
    return { ok: true };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(suggestion.valueJson);
  } catch {
    return { ok: false, error: "invalid_payload" };
  }

  if (suggestion.suggestionType === "occurred_at") {
    // M3-E：收件箱阶段的 occurred_at 建议只作为「确认成事件」时的预填值，
    // 绝不直接改写任何 Asset 的 capturedAt/importedAt（素材拍摄时间不可被 AI 触碰）。
    // 事件时间在用户点击「确认进入时间轴」时由 confirm 流程写入。
    const raw = (editedValue ?? (payload.occurredAt as string) ?? "").trim();
    if (!raw) return { ok: false, error: "invalid_time" };
    const occurredAt = new Date(raw);
    if (Number.isNaN(occurredAt.getTime())) {
      return { ok: false, error: "invalid_time" };
    }
  }

  // accept：记录审计状态；实际取值由收件箱确认表单预填（title/occurredAt）
  await db
    .update(aiSuggestion)
    .set({
      status: "accepted",
      resolvedAt: now,
      resolvedByUserId: userId,
    })
    .where(eq(aiSuggestion.id, suggestionId))
    .run();

  return { ok: true };
}
