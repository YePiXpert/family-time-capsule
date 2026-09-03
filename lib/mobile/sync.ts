import "server-only";

import type { FamilyRole } from "@/lib/authz/policy";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { getFamily, listPeople } from "@/lib/family/service";
import { getTimelinePage } from "@/lib/memories/service";

export const MOBILE_API_VERSION = 1;

export type MobileViewerDto = {
  id: string;
  name: string;
  role: FamilyRole;
  canCapture: boolean;
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
  title: string;
  occurredAt: string;
  occurredAtPrecision: string;
  locationText: string | null;
  childPersonId: string;
  ageDays: number | null;
  updatedAt: string;
  assetCount: number;
  participantNames: string[];
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

export async function getMobileSyncPage(input: {
  familyId: string;
  userId: string;
  userName: string;
  role: FamilyRole;
  cursor?: string | null;
  limit?: number;
}): Promise<MobileSyncPageDto> {
  const [family, people, timeline] = await Promise.all([
    getFamily(input.familyId),
    listPeople(input.familyId),
    getTimelinePage(input.familyId, {
      cursor: input.cursor,
      limit: input.limit,
    }),
  ]);
  if (!family) throw new Error("authorized family is unavailable");

  return {
    apiVersion: MOBILE_API_VERSION,
    serverTime: new Date().toISOString(),
    viewer: {
      id: input.userId,
      name: input.userName,
      role: input.role,
      canCapture: hasFamilyCapability(input.role, "capture:create"),
      canEditEvents: hasFamilyCapability(input.role, "event:write"),
    },
    family: {
      id: family.id,
      name: family.name,
      timezone: family.timezone,
    },
    people: people.map((person) => ({
      id: person.id,
      displayName: person.displayName,
      relationToChild: person.relationToChild,
      isChild: person.isChild,
      birthDate: person.birthDate,
      updatedAt: person.updatedAt.toISOString(),
    })),
    events: timeline.entries.map((entry) => {
      const mediaAssetId = entry.coverThumbAssetId ?? entry.coverAssetId;
      return {
        id: entry.event.id,
        title: entry.event.title,
        occurredAt: entry.event.occurredAt.toISOString(),
        occurredAtPrecision: entry.event.occurredAtPrecision,
        locationText: entry.event.locationText,
        childPersonId: entry.event.childPersonId,
        ageDays: entry.event.ageDays,
        updatedAt: entry.event.updatedAt.toISOString(),
        assetCount: entry.assetCount,
        participantNames: entry.participantNames,
        cover:
          entry.coverAssetId && mediaAssetId
            ? {
                assetId: entry.coverAssetId,
                mediaAssetId,
                type: entry.coverAssetType,
                mimeType: entry.coverAssetMime,
                path: `/api/media/${encodeURIComponent(mediaAssetId)}`,
              }
            : null,
      };
    }),
    nextCursor: timeline.nextCursor,
  };
}
