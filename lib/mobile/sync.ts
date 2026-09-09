import "server-only";
import { isOccurredAtPrecision, precisionHasDay } from "@/lib/metadata/precision";
import { readSyncStamp, assertSyncStamp, MOBILE_SYNC_STAMP, type StampedSyncPage } from "./sync-state";

import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { inboxItem } from "@/db/schema/inbox";
import type { FamilyRole } from "@/lib/authz/policy";
import { hasFamilyCapability } from "@/lib/authz/policy";
import type { FamilyContext } from "@/lib/family/context";
import { getFamily, listPeople } from "@/lib/family/service";
import { getTimelinePage, type PersonRow, type TimelineEntry } from "@/lib/memories/service";
import { formatPersonAgeLabel } from "@/lib/memories/age";

export const MOBILE_API_VERSION = 1;

export type MobileViewerDto = {
  id: string;
  name: string;
  role: FamilyRole;
  personId: string | null;
  canCapture: boolean;
  canReviewInbox: boolean;
  canCreateContributions: boolean;
  canEditEvents: boolean;
};

export type MobileFamilyDto = {
  id: string;
  name: string;
  timezone: string;
};

export type MobilePersonDto = {
  id: string;
  displayName: string;
  relationToChild: string | null;
  isChild: boolean;
  birthDate: string | null;
  updatedAt: string;
};

export type MobileTimelineEventDto = {
  id: string;
  bodyText: string;
  milestoneType: string | null;
  title: string;
  occurredAt: string;
  occurredAtPrecision: string;
  locationText: string | null;
  childPersonId: string | null;
  ageDays: number | null;
  ageLabel: string | null;
  updatedAt: string;
  assetCount: number;
  participantNames: string[];
  participantIds: string[];
  captureIds: string[];
  cover: null | {
    assetId: string;
    mediaAssetId: string;
    type: string | null;
    mimeType: string | null;
    path: string;
  };
};

export type MobileSyncPageDto = {
  apiVersion: typeof MOBILE_API_VERSION;
  serverTime: string;
  viewer: MobileViewerDto;
  family: MobileFamilyDto;
  people: MobilePersonDto[];
  events: MobileTimelineEventDto[];
  nextCursor: string | null;
};

export function mobileSyncMetadata(context: FamilyContext, family: MobileFamilyDto): Pick<MobileSyncPageDto, "apiVersion" | "serverTime" | "viewer" | "family"> {
  return { apiVersion: MOBILE_API_VERSION, serverTime: new Date().toISOString(), family,
    viewer: { id: context.userId, name: context.userName, role: context.role, personId: context.personId,
      canCapture: hasFamilyCapability(context.role, "capture:create"), canReviewInbox: hasFamilyCapability(context.role, "inbox:review"),
      canCreateContributions: hasFamilyCapability(context.role, "contribution:create"), canEditEvents: hasFamilyCapability(context.role, "event:write") } };
}
export function mobilePerson(person: PersonRow): MobilePersonDto {
  return { id: person.id, displayName: person.displayName, relationToChild: person.relationToChild, isChild: person.isChild, birthDate: person.birthDate, updatedAt: person.updatedAt.toISOString() };
}
export function mobileTimelineEvents(context: FamilyContext, family: MobileFamilyDto, people: PersonRow[], entries: TimelineEntry[]): MobileTimelineEventDto[] {
  const eventIds = entries.map(entry => entry.event.id);
  const captures = eventIds.length ? getDb().select({ id: inboxItem.id, eventId: inboxItem.memoryEventId }).from(inboxItem)
    .where(and(eq(inboxItem.familyId, context.familyId), inArray(inboxItem.memoryEventId, eventIds))).all() : [];
  const ids = new Map<string, string[]>();
  for (const row of captures) if (row.eventId) ids.set(row.eventId, [...(ids.get(row.eventId) ?? []), row.id]);
  return entries.map(entry => {
    const mediaAssetId = entry.coverThumbAssetId ?? entry.coverAssetId;
    const anchor = people.find(person => person.id === entry.event.childPersonId);
    const hasDay = isOccurredAtPrecision(entry.event.occurredAtPrecision) && precisionHasDay(entry.event.occurredAtPrecision);
    return { id: entry.event.id, bodyText: entry.event.bodyText, milestoneType: entry.event.milestoneType, title: entry.event.title, occurredAt: entry.event.occurredAt.toISOString(), occurredAtPrecision: entry.event.occurredAtPrecision,
      locationText: entry.event.locationText, childPersonId: entry.event.childPersonId,
      ageDays: hasDay ? entry.event.ageDays : null,
      ageLabel: hasDay ? formatPersonAgeLabel(anchor, entry.event.occurredAt, family.timezone) : null,
      updatedAt: entry.event.updatedAt.toISOString(), assetCount: entry.assetCount, participantNames: entry.participantNames, participantIds: entry.participantIds ?? [], captureIds: ids.get(entry.event.id) ?? [],
      cover: entry.coverAssetId && mediaAssetId ? { assetId: entry.coverAssetId, mediaAssetId, type: entry.coverAssetType, mimeType: entry.coverAssetMime, path: `/api/media/${encodeURIComponent(mediaAssetId)}` } : null };
  });
}
export async function getMobileSyncPage(input: { context: FamilyContext; cursor?: string | null; limit?: number }): Promise<MobileSyncPageDto & StampedSyncPage> {
  const stamp = readSyncStamp(input.context);
  const [family, people, timeline] = await Promise.all([getFamily(input.context.familyId), listPeople(input.context.familyId), getTimelinePage(input.context, { cursor: input.cursor, limit: input.limit })]);
  if (!family) throw new Error("authorized family is unavailable");
  const events = mobileTimelineEvents(input.context, family, people, timeline.entries);
  assertSyncStamp(input.context, stamp);
  return { ...mobileSyncMetadata(input.context, { id: family.id, name: family.name, timezone: family.timezone }), people: people.map(mobilePerson), events, nextCursor: timeline.nextCursor, [MOBILE_SYNC_STAMP]: stamp };
}
