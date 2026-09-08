import "server-only";
import { and, asc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { family, person } from "@/db/schema/family";
import { memoryEvent } from "@/db/schema/memory";
import { syncChange } from "@/db/schema/sync";
import { createEventAccessSnapshot, eventVisibilityCondition } from "@/lib/authz/event-access";
import type { FamilyContext } from "@/lib/family/context";
import { hydrateTimelineEntries } from "@/lib/memories/service";
import { mobilePerson, mobileSyncMetadata, mobileTimelineEvents, type MobileSyncPageDto } from "./sync";
import { assertSyncStamp, loadSyncCursor, MOBILE_SYNC_STAMP, pruneSyncChanges, readSyncStamp, saveSyncCursor, type StampedSyncPage, type SyncCursorState } from "./sync-state";

export type MobileSyncProtocolPage = MobileSyncPageDto & StampedSyncPage & {
  tombstones: { kind: "memory" | "person"; id: string }[];
  sync: { protocol: 2; mode: "snapshot" | "delta"; generation: string; permissionStamp: string; checkpoint: string | null; invalidateResources: boolean };
};

/** A fixed revision fence rejects mixed pages. Clients stage the whole round and retry from their last checkpoint. */
export async function getMobileSyncProtocolPage(context: FamilyContext, cursor: string | null, requestedLimit = 50): Promise<MobileSyncProtocolPage> {
  pruneSyncChanges();
  const stamp = readSyncStamp(context), db = getDb();
  const limit = Number.isSafeInteger(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 50;
  const saved = cursor ? loadSyncCursor(context, cursor, stamp) : null;
  const state: SyncCursorState = saved?.mode === "checkpoint"
    ? { ...saved, mode: "delta", from: saved.fence, afterSeq: saved.fence, fence: stamp.globalSeq, revision: stamp.revision }
    : saved ?? { version: 2, generation: stamp.generation, permissionStamp: stamp.permissionStamp, mode: "snapshot", phase: "people", fence: stamp.globalSeq, revision: stamp.revision, from: 0, afterSeq: 0, afterId: null };
  const group = db.select().from(family).where(eq(family.id, context.familyId)).get()!;
  const visible = eventVisibilityCondition(createEventAccessSnapshot(context));
  let people: (typeof person.$inferSelect)[] = [], events: (typeof memoryEvent.$inferSelect)[] = [];
  let next: SyncCursorState | null = null;
  const tombstones: MobileSyncProtocolPage["tombstones"] = [];
  let invalidateResources = false;
  if (state.mode === "snapshot" && state.phase === "people") {
    const rows = db.select().from(person).where(and(eq(person.familyId, context.familyId), state.afterId ? gt(person.id, state.afterId) : undefined)).orderBy(asc(person.id)).limit(limit + 1).all();
    people = rows.slice(0, limit);
    next = rows.length > limit ? { ...state, afterId: people.at(-1)!.id } : { ...state, phase: "events", afterId: null };
  } else if (state.mode === "snapshot") {
    const rows = db.select().from(memoryEvent).where(and(eq(memoryEvent.familyId, context.familyId), eq(memoryEvent.status, "confirmed"), isNull(memoryEvent.deletedAt), visible,
      state.afterId ? gt(memoryEvent.id, state.afterId) : undefined)).orderBy(asc(memoryEvent.id)).limit(limit + 1).all();
    events = rows.slice(0, limit);
    if (rows.length > limit) next = { ...state, afterId: events.at(-1)!.id };
  } else {
    const rows = db.select().from(syncChange).where(and(eq(syncChange.familyId, context.familyId), gt(syncChange.seq, state.afterSeq), lte(syncChange.seq, state.fence),
      sql`(${syncChange.kind}<>'memory' or ${syncChange.visibility}='family' or ${syncChange.authorUserId}=${context.userId} or (${syncChange.visibility}='members' and exists(select 1 from json_each(${syncChange.readerIdsJson}) where value=${context.userId})))`,
    )).orderBy(asc(syncChange.seq)).limit(limit + 1).all();
    const changes = rows.slice(0, limit);
    const memoryIds = [...new Set(changes.filter(row => row.kind === "memory" && row.entityId).map(row => row.entityId!))];
    const personIds = [...new Set(changes.filter(row => row.kind === "person" && row.entityId).map(row => row.entityId!))];
    events = memoryIds.length ? db.select().from(memoryEvent).where(and(eq(memoryEvent.familyId, context.familyId), inArray(memoryEvent.id, memoryIds), eq(memoryEvent.status, "confirmed"), isNull(memoryEvent.deletedAt), visible)).all() : [];
    people = personIds.length ? db.select().from(person).where(and(eq(person.familyId, context.familyId), inArray(person.id, personIds))).all() : [];
    const currentEvents = new Set(events.map(row => row.id)), currentPeople = new Set(people.map(row => row.id));
    for (const id of memoryIds) if (!currentEvents.has(id)) tombstones.push({ kind: "memory", id });
    for (const id of personIds) if (!currentPeople.has(id)) tombstones.push({ kind: "person", id });
    invalidateResources = changes.some(row => row.revocation);
    if (rows.length > limit) next = { ...state, afterSeq: changes.at(-1)!.seq };
  }
  const childIds = [...new Set(events.flatMap(event => event.childPersonId ? [event.childPersonId] : []))];
  const anchors = childIds.length ? db.select().from(person).where(and(eq(person.familyId, context.familyId), inArray(person.id, childIds))).all() : [];
  const entries = await hydrateTimelineEntries(context.familyId, events, context);
  const eventDtos = mobileTimelineEvents(context, group, anchors, entries);
  return db.transaction(() => {
    assertSyncStamp(context, stamp);
    const nextCursor = next ? saveSyncCursor(context, next) : null;
    const checkpoint = next ? null : saveSyncCursor(context, { ...state, mode: "checkpoint", afterId: null, afterSeq: state.fence });
    return { ...mobileSyncMetadata(context, { id: group.id, name: group.name, timezone: group.timezone }), people: people.map(mobilePerson), events: eventDtos, nextCursor, tombstones,
      sync: { protocol: 2 as const, mode: state.mode === "snapshot" ? "snapshot" as const : "delta" as const, generation: stamp.generation, permissionStamp: stamp.permissionStamp, checkpoint, invalidateResources }, [MOBILE_SYNC_STAMP]: stamp };
  });
}
