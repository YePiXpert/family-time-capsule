import "server-only";

import type { FamilyContext } from "@/lib/family/context";
import { createContributionAccessSnapshot, listVisibleContributionsForEvent } from "@/lib/authz/contribution-access";
import { getThumbnailMap } from "@/lib/assets/service";
import { getHomeDashboard } from "@/lib/home/service";
import { getInboxPage, type InboxEntry } from "@/lib/inbox/service";
import { getMemoryEventDetail } from "@/lib/memories/service";
import { formatAgeLabel } from "@/lib/memories/age";
import { utcToZonedWallTimeInput } from "@/lib/metadata/time";
import { searchFamily } from "@/lib/search/service";

function mediaPath(assetId: string): string {
  return `/api/media/${encodeURIComponent(assetId)}`;
}

function inboxTitle(entry: InboxEntry): string {
  return entry.item.draftTitle?.trim() || entry.item.rawText?.trim().slice(0, 100) || entry.assets[0]?.originalFilename || "待整理素材";
}

export async function getMobileHome(context: FamilyContext) {
  const dashboard = await getHomeDashboard(context);
  return {
    family: { name: dashboard.family.name, timezone: dashboard.family.timezone },
    child: dashboard.child ? {
      id: dashboard.child.id,
      displayName: dashboard.child.displayName,
      currentAgeLabel: dashboard.child.currentAgeLabel,
      avatarPath: dashboard.child.avatar ? mediaPath(dashboard.child.avatar.thumbAssetId ?? dashboard.child.avatar.assetId) : null,
    } : null,
    capabilities: { canCapture: dashboard.canCapture },
    inbox: {
      count: dashboard.inbox.count,
      previews: dashboard.inbox.previews.map((preview) => ({
        id: preview.id,
        title: preview.title,
        status: preview.status,
        mediaPath: preview.media ? mediaPath(preview.media.thumbAssetId ?? preview.media.assetId) : null,
      })),
    },
    recentMemories: dashboard.recentMemories.slice(0, 5).map((memory) => ({
      id: memory.id,
      title: memory.title,
      occurredAt: memory.occurredAt.toISOString(),
      ageLabel: memory.ageLabel,
      coverPath: memory.cover ? mediaPath(memory.cover.thumbAssetId ?? memory.cover.assetId) : null,
    })),
    onThisDay: dashboard.onThisDay.map((memory) => ({ id: memory.id, title: memory.title, occurredAt: memory.occurredAt.toISOString() })),
    story: dashboard.recentStory ? { id: dashboard.recentStory.id, title: dashboard.recentStory.title, status: dashboard.recentStory.status } : null,
    capsule: dashboard.upcomingCapsule ? { id: dashboard.upcomingCapsule.id, title: dashboard.upcomingCapsule.title, status: dashboard.upcomingCapsule.status, unlockType: dashboard.upcomingCapsule.unlockType, unlockValue: dashboard.upcomingCapsule.unlockValue, unlocked: dashboard.upcomingCapsule.unlocked } : null,
    prompt: dashboard.familyPrompt,
    weeklyReview: dashboard.weeklyReview,
    monthlyReview: dashboard.monthlyReview,
    activeBooks: dashboard.activeBooks,
    isFirstUse: dashboard.isFirstUse,
  };
}

export async function getMobileInbox(context: FamilyContext, cursor: string | null, limit: number) {
  const page = await getInboxPage(context.familyId, undefined, { cursor, limit });
  return {
    entries: await mapMobileInboxEntries(context, page.entries),
    nextCursor: page.nextCursor,
  };
}

async function mapMobileInboxEntries(
  context: FamilyContext,
  entries: InboxEntry[],
) {
  const imageIds = entries.flatMap((entry) => entry.assets.filter((asset) => asset.type === "image").map((asset) => asset.id));
  const thumbnails = await getThumbnailMap(context.familyId, imageIds);
  return entries.map((entry) => ({
      id: entry.item.id,
      kind: entry.item.kind,
      status: entry.item.status,
      title: inboxTitle(entry),
      rawText: entry.item.rawText,
      occurredAt: entry.item.draftOccurredAt?.toISOString() ?? entry.assets[0]?.capturedAt?.toISOString() ?? null,
      occurredAtWall: entry.item.draftOccurredAt
        ? utcToZonedWallTimeInput(entry.item.draftOccurredAt, context.familyTimezone)
        : entry.assets[0]?.capturedAt
          ? utcToZonedWallTimeInput(entry.assets[0].capturedAt, context.familyTimezone)
          : null,
      locationText: entry.item.draftLocationText,
      participantPersonIds: entry.participantPersonIds,
      createdAt: entry.item.createdAt.toISOString(),
      assets: entry.assets.map((asset) => ({
        id: asset.id,
        type: asset.type,
        filename: asset.originalFilename,
        mimeType: asset.mimeType,
        capturedAt: asset.capturedAt?.toISOString() ?? null,
        mediaPath: mediaPath(asset.id),
        thumbnailPath: asset.type === "image" ? mediaPath(thumbnails.get(asset.id)?.id ?? asset.id) : null,
      })),
    }));
}

export async function getMobileInboxEntry(
  context: FamilyContext,
  entry: InboxEntry,
) {
  return (await mapMobileInboxEntries(context, [entry]))[0] ?? null;
}

export async function getMobileMemory(context: FamilyContext, eventId: string) {
  const [detail, contributions] = await Promise.all([
    getMemoryEventDetail(context.familyId, eventId),
    listVisibleContributionsForEvent(createContributionAccessSnapshot(context), eventId),
  ]);
  if (!detail) return null;
  const thumbnails = await getThumbnailMap(context.familyId, detail.assets.map((asset) => asset.id));
  const child = detail.participants.find((person) => person.id === detail.event.childPersonId);
  return {
    id: detail.event.id,
    title: detail.event.title,
    occurredAt: detail.event.occurredAt.toISOString(),
    occurredAtWall: utcToZonedWallTimeInput(detail.event.occurredAt, context.familyTimezone),
    occurredAtPrecision: detail.event.occurredAtPrecision,
    ageDays: detail.event.ageDays,
    ageLabel: child?.birthDate
      ? formatAgeLabel(child.birthDate, detail.event.occurredAt, context.familyTimezone)
      : null,
    locationText: detail.event.locationText,
    milestoneType: detail.event.milestoneType,
    isPinned: detail.event.isPinned,
    childPersonId: detail.event.childPersonId,
    participantPersonIds: detail.participants.map((person) => person.id),
    participants: detail.participants.map((person) => ({ id: person.id, displayName: person.displayName, relationToChild: person.relationToChild, isChild: person.isChild })),
    sourceNotes: detail.sourceNotes.map((note) => ({ id: note.id, text: note.rawText })),
    assets: detail.assets.map((asset) => ({
      id: asset.id,
      type: asset.type,
      filename: asset.originalFilename,
      mimeType: asset.mimeType,
      durationMs: asset.durationMs,
      mediaPath: mediaPath(asset.id),
      thumbnailPath: asset.type === "image" ? mediaPath(thumbnails.get(asset.id)?.id ?? asset.id) : null,
    })),
    contributions: contributions.map((contribution) => ({
      id: contribution.id,
      authorPersonId: contribution.authorPersonId,
      authorName: contribution.authorName,
      text: contribution.editedText ?? contribution.rawText ?? contribution.transcript ?? "",
      visibility: contribution.visibility,
      canEdit: contribution.canEdit,
      createdAt: contribution.createdAt.toISOString(),
      audioPath: contribution.audioAssetId ? mediaPath(contribution.audioAssetId) : null,
    })),
    updatedAt: detail.event.updatedAt.toISOString(),
  };
}

type MobileSearchItem = { type: string; id: string; eventId: string | null; title: string; snippet: string };

function searchCursor(value: string | null, query: string): number {
  if (!value) return 0;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { q?: unknown; offset?: unknown };
    return decoded.q === query && Number.isSafeInteger(decoded.offset) && Number(decoded.offset) >= 0 ? Number(decoded.offset) : 0;
  } catch {
    return 0;
  }
}

export function getMobileSearch(context: FamilyContext, query: string, cursor: string | null, limit: number) {
  const result = searchFamily(context, { q: query, limit: 100 });
  const items: MobileSearchItem[] = [
    ...result.events.map((item) => ({ type: "memory", id: item.id, eventId: item.id, title: item.title, snippet: item.snippet })),
    ...result.facts.map((item) => ({ type: "fact", id: item.id, eventId: item.eventId, title: item.statement, snippet: item.statement })),
    ...result.contributions.map((item) => ({ type: "contribution", id: item.id, eventId: item.eventId, title: item.authorName ?? "家人讲述", snippet: item.text })),
    ...result.transcripts.map((item) => ({ type: "transcript", id: item.id, eventId: item.eventId, title: "录音转录", snippet: item.text })),
    ...result.stories.map((item) => ({ type: "story", id: item.id, eventId: null, title: item.title, snippet: item.snippet })),
  ];
  const offset = searchCursor(cursor, query);
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const page = items.slice(offset, offset + safeLimit);
  const nextOffset = offset + page.length;
  return {
    items: page,
    nextCursor: nextOffset < items.length ? Buffer.from(JSON.stringify({ q: query, offset: nextOffset }), "utf8").toString("base64url") : null,
  };
}
