import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { aiSuggestion, memoryEventTag } from "@/db/schema/suggestion";
import { memoryEvent, memoryEventParticipant } from "@/db/schema/memory";
import { person as personTable } from "@/db/schema/family";
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
