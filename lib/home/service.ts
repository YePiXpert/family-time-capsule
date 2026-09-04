import "server-only";

import type { FamilyContext } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { createContributionAccessSnapshot } from "@/lib/authz/contribution-access";
import { getAsset, getThumbnailMap } from "@/lib/assets/service";
import { listCapsules } from "@/lib/capsules/service";
import { getFamily, listPeople } from "@/lib/family/service";
import { countInbox, getInboxPage, type InboxStatus } from "@/lib/inbox/service";
import { formatAgeLabel } from "@/lib/memories/age";
import {
  getTimelinePage,
  listMilestoneEntries,
  type TimelineEntry,
} from "@/lib/memories/service";
import { getResurfacing, type ResurfacingKind } from "@/lib/memories/resurfacing";
import {
  PROMPT_LIBRARY,
  listContributionRequests,
} from "@/lib/oral-history/service";
import { listStories } from "@/lib/stories/service";

export type HomeMemoryDto = {
  id: string;
  title: string;
  occurredAt: Date;
  ageLabel: string | null;
  locationText: string | null;
  participantNames: string[];
  assetCount: number;
  milestoneType: string | null;
  isPinned: boolean;
  cover: null | {
    assetId: string;
    type: string | null;
    mimeType: string;
    thumbAssetId: string | null;
  };
};

export type HomeInboxPreviewDto = {
  id: string;
  title: string;
  status: InboxStatus;
  media: null | {
    assetId: string;
    type: string;
    mimeType: string;
    thumbAssetId: string | null;
  };
};

export type HomeDashboardDto = {
  family: { id: string; name: string; timezone: string };
  child: null | {
    id: string;
    displayName: string;
    birthDate: string | null;
    currentAgeLabel: string | null;
    avatar: null | { assetId: string; mimeType: string; thumbAssetId: string | null };
  };
  canCapture: boolean;
  inbox: { count: number; previews: HomeInboxPreviewDto[] };
  recentMemories: HomeMemoryDto[];
  onThisDay: HomeMemoryDto[];
  resurfacing: Array<{
    kind: ResurfacingKind;
    label: string;
    targetDate: string;
    memories: HomeMemoryDto[];
  }>;
  milestones: HomeMemoryDto[];
  recentStory: null | {
    id: string;
    title: string;
    kind: string;
    status: string;
    paragraphCount: number;
    periodStart: Date;
    periodEnd: Date;
  };
  upcomingCapsule: null | {
    id: string;
    title: string;
    status: string;
    unlockType: string;
    unlockValue: string;
    unlocked: boolean;
    itemCount: number;
  };
  familyPrompt: {
    text: string;
    recipientLabel: string | null;
    pendingCount: number;
    isCreatedRequest: boolean;
  };
  isFirstUse: boolean;
};

function mapMemory(
  entry: TimelineEntry,
  childBirthDate: string | null,
  timezone: string,
): HomeMemoryDto {
  return {
    id: entry.event.id,
    title: entry.event.title,
    occurredAt: entry.event.occurredAt,
    ageLabel: childBirthDate
      ? formatAgeLabel(childBirthDate, entry.event.occurredAt, timezone)
      : null,
    locationText: entry.event.locationText,
    participantNames: entry.participantNames,
    assetCount: entry.assetCount,
    milestoneType: entry.event.milestoneType,
    isPinned: entry.event.isPinned,
    cover: entry.coverAssetId
      ? {
          assetId: entry.coverAssetId,
          type: entry.coverAssetType,
          mimeType: entry.coverAssetMime ?? "application/octet-stream",
          thumbAssetId: entry.coverThumbAssetId,
        }
      : null,
  };
}

/**
 * Central dashboard read model. Each domain is loaded in bounded pages/batches;
 * the page never loops over entities to issue database queries.
 */
export async function getHomeDashboard(
  context: FamilyContext,
  now = new Date(),
): Promise<HomeDashboardDto> {
  const [family, people] = await Promise.all([
    getFamily(context.familyId),
    listPeople(context.familyId),
  ]);
  if (!family) throw new Error("authorized family is unavailable");
  const child = people.find((person) => person.isChild) ?? null;
  const snapshot = createContributionAccessSnapshot(context, now);
  const [
    inboxCount,
    inboxPage,
    timelinePage,
    stories,
    capsules,
    requests,
    resurfacing,
    milestoneEntries,
  ] =
    await Promise.all([
      countInbox(context.familyId),
      getInboxPage(context.familyId, undefined, { limit: 4 }),
      getTimelinePage(context.familyId, { limit: 50 }),
      listStories(context.familyId),
      listCapsules(snapshot, child?.birthDate ?? null),
      Promise.resolve(listContributionRequests(context)),
      getResurfacing(context.familyId, family.timezone, now, 3),
      listMilestoneEntries(context.familyId, 4),
    ]);

  const inboxCoverIds = inboxPage.entries
    .map((entry) => entry.assets.find((asset) => asset.type === "image")?.id)
    .filter((id): id is string => Boolean(id));
  const inboxThumbs = await getThumbnailMap(context.familyId, inboxCoverIds);
  const inboxPreviews = inboxPage.entries.map((entry): HomeInboxPreviewDto => {
    const preferred =
      entry.assets.find((asset) => asset.type === "image") ?? entry.assets[0];
    const rawTitle =
      entry.item.rawText?.trim() || preferred?.originalFilename || "待整理素材";
    return {
      id: entry.item.id,
      title: rawTitle.length > 46 ? `${rawTitle.slice(0, 46)}…` : rawTitle,
      status: entry.item.status as InboxStatus,
      media: preferred
        ? {
            assetId: preferred.id,
            type: preferred.type,
            mimeType: preferred.mimeType,
            thumbAssetId: inboxThumbs.get(preferred.id)?.id ?? null,
          }
        : null,
    };
  });

  const avatarAsset = child?.avatarAssetId
    ? await getAsset(context.familyId, child.avatarAssetId)
    : undefined;
  const avatarThumbs = avatarAsset
    ? await getThumbnailMap(context.familyId, [avatarAsset.id])
    : new Map();
  const allRecent = timelinePage.entries.map((entry) =>
    mapMemory(entry, child?.birthDate ?? null, family.timezone),
  );
  const resurfacingGroups = resurfacing.groups.map((group) => ({
    kind: group.kind,
    label: group.label,
    targetDate: group.targetDate,
    memories: group.entries.map((entry) =>
      mapMemory(entry, child?.birthDate ?? null, family.timezone),
    ),
  }));
  const onThisDay =
    resurfacingGroups.find((group) => group.kind === "on_this_day")?.memories ?? [];
  const recentStory = [...stories].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  )[0];
  const upcomingCapsule = capsules.find(
    (capsule) => capsule.status !== "opened",
  ) ?? capsules[0];
  const openRequest = requests.find(
    (request) => request.status === "open" && request.expiresAt > now,
  );
  const fallbackPrompt = PROMPT_LIBRARY[0]?.questions[0] ?? "今天想问家人一个什么问题？";

  return {
    family: { id: family.id, name: family.name, timezone: family.timezone },
    child: child
      ? {
          id: child.id,
          displayName: child.displayName,
          birthDate: child.birthDate,
          currentAgeLabel: child.birthDate
            ? formatAgeLabel(child.birthDate, now, family.timezone)
            : null,
          avatar: avatarAsset
            ? {
                assetId: avatarAsset.id,
                mimeType: avatarAsset.mimeType,
                thumbAssetId: avatarThumbs.get(avatarAsset.id)?.id ?? null,
              }
            : null,
        }
      : null,
    canCapture: hasFamilyCapability(context.role, "capture:create"),
    inbox: { count: inboxCount, previews: inboxPreviews },
    recentMemories: allRecent.slice(0, 6),
    onThisDay,
    resurfacing: resurfacingGroups,
    milestones: milestoneEntries.map((entry) =>
      mapMemory(entry, child?.birthDate ?? null, family.timezone),
    ),
    recentStory: recentStory
      ? {
          id: recentStory.id,
          title: recentStory.title,
          kind: recentStory.kind,
          status: recentStory.status,
          paragraphCount: recentStory.paragraphCount,
          periodStart: recentStory.periodStart,
          periodEnd: recentStory.periodEnd,
        }
      : null,
    upcomingCapsule: upcomingCapsule
      ? {
          id: upcomingCapsule.id,
          title: upcomingCapsule.title,
          status: upcomingCapsule.status,
          unlockType: upcomingCapsule.unlockType,
          unlockValue: upcomingCapsule.unlockValue,
          unlocked: upcomingCapsule.unlocked,
          itemCount: upcomingCapsule.itemCount,
        }
      : null,
    familyPrompt: openRequest
      ? {
          text: openRequest.promptText,
          recipientLabel: openRequest.recipientLabel,
          pendingCount: openRequest.pendingCount,
          isCreatedRequest: true,
        }
      : {
          text: fallbackPrompt,
          recipientLabel: null,
          pendingCount: 0,
          isCreatedRequest: false,
        },
    isFirstUse: inboxCount === 0 && allRecent.length === 0,
  };
}
