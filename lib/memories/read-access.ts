import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { memoryEventReader } from "@/db/schema/memory";
import { asset } from "@/db/schema/asset";
import { createContributionAccessSnapshot, listVisibleContributionsForEvent, readableAssetPredicate } from "@/lib/authz/contribution-access";
import { canManageEventVisibilityInTransaction, createEventAccessSnapshot } from "@/lib/authz/event-access";
import { listFacts, listFactSources } from "@/lib/contributions/service";
import type { FamilyContext } from "@/lib/family/context";
import { getVisibleMemoryEventDetail, type TimelineEntry } from "./service";

/** One SQLite snapshot for the content used by memory readers and editors. */
export function readMemoryContent(context: FamilyContext, eventId: string) {
  return getDb().transaction(tx => {
    const detail = getVisibleMemoryEventDetail(context, eventId);
    if (!detail) return undefined;
    const access = createContributionAccessSnapshot(context);
    const visibleContributions = listVisibleContributionsForEvent(access, eventId);
    const audioIds = [...new Set(visibleContributions.flatMap(c => c.audioAssetId ? [c.audioAssetId] : []))];
    const audioAssets = audioIds.length ? tx.select().from(asset).where(and(
      eq(asset.familyId, context.familyId), inArray(asset.id, audioIds), readableAssetPredicate(access, sql`${asset.id}`),
    )).all() : [];
    const readableAudioIds = new Set(audioAssets.map(asset => asset.id));
    const contributions = visibleContributions.map(c => ({ ...c, audioAssetId: c.audioAssetId && readableAudioIds.has(c.audioAssetId) ? c.audioAssetId : null }));
    const facts = listFacts(context, eventId);
    const sources = listFactSources(context, facts.map(f => f.id));
    const canWrite = canManageEventVisibilityInTransaction(tx, createEventAccessSnapshot(context), eventId);
    const readerUserIds = canWrite ? tx.select({ id: memoryEventReader.userId }).from(memoryEventReader).where(and(eq(memoryEventReader.familyId, context.familyId), eq(memoryEventReader.memoryEventId, eventId))).all().map(reader => reader.id).sort() : [];
    const content = { detail, contributions, audioAssets, facts, sources, canWrite, readerUserIds };
    return { ...content, version: createHash("sha256").update(JSON.stringify(content)).digest("hex") };
  });
}

/** Async page dependencies must not hand off an older permission/content snapshot. */
export function isMemoryContentCurrent(context: FamilyContext, eventId: string, version: string): boolean {
  return readMemoryContent(context, eventId)?.version === version;
}

/** Related cards have independent reader grants and must be refreshed at handoff. */
export function refreshMemoryCards(context: FamilyContext, entries: TimelineEntry[]): TimelineEntry[] {
  return getDb().transaction(tx => entries.flatMap(entry => {
    const current = getVisibleMemoryEventDetail(context, entry.event.id);
    if (!current) return [];
    const snapshot = createContributionAccessSnapshot(context);
    const coverIds = [entry.coverAssetId, entry.coverThumbAssetId].filter((id): id is string => Boolean(id));
    const coverReadable = coverIds.length > 0 && tx.select({ id: asset.id }).from(asset).where(and(
      inArray(asset.id, coverIds), readableAssetPredicate(snapshot, sql`${asset.id}`),
    )).all().length === new Set(coverIds).size;
    return [{ ...entry, event: current.event, assetCount: current.assets.length,
      participantNames: current.participants.map(person => person.displayName),
      ...(!coverReadable ? { coverAssetId: null, coverThumbAssetId: null, coverAssetType: null, coverAssetMime: null } : {}),
    }];
  }));
}
