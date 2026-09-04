import "server-only";

import type { FamilyContext } from "@/lib/family/context";
import { createContributionAccessSnapshot } from "@/lib/authz/contribution-access";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { listPeople } from "@/lib/family/service";
import { getPersonProfile } from "@/lib/family/profile";
import { getStory, listStories } from "@/lib/stories/service";
import { getCapsuleDetail, listCapsules } from "@/lib/capsules/service";
import { listContributionRequests } from "@/lib/oral-history/service";
import {
  listContributionPortals,
  listPortalSubmissionBundles,
} from "@/lib/contribution-portals/service";
import { getImportSessionDetail, listImportSessions } from "@/lib/imports/service";

export const MOBILE_LIBRARY_DOMAINS = [
  "people",
  "stories",
  "capsules",
  "requests",
  "portals",
  "imports",
] as const;

export type MobileLibraryDomain = (typeof MOBILE_LIBRARY_DOMAINS)[number];
export type MobileLibraryItem = {
  id: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  updatedAt: string;
  meta: Record<string, string | number | boolean | null>;
};

function encodeCursor(domain: MobileLibraryDomain, offset: number): string {
  return Buffer.from(JSON.stringify({ v: 1, domain, offset }), "utf8").toString("base64url");
}

function cursorOffset(domain: MobileLibraryDomain, cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>;
    return value.v === 1 && value.domain === domain && Number.isSafeInteger(value.offset) && Number(value.offset) >= 0
      ? Number(value.offset)
      : 0;
  } catch {
    return 0;
  }
}

function paginate(domain: MobileLibraryDomain, rows: MobileLibraryItem[], cursor: string | null, limit: number) {
  const offset = cursorOffset(domain, cursor);
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const items = rows.slice(offset, offset + safeLimit);
  const nextOffset = offset + items.length;
  return { items, nextCursor: nextOffset < rows.length ? encodeCursor(domain, nextOffset) : null };
}

export async function getMobileLibraryPage(
  context: FamilyContext,
  domain: MobileLibraryDomain,
  cursor: string | null,
  limit: number,
) {
  if (domain === "people") {
    const rows = (await listPeople(context.familyId)).map((row) => ({
      id: row.id,
      title: row.displayName,
      subtitle: row.relationToChild,
      status: row.isChild ? "child" : "family",
      updatedAt: row.updatedAt.toISOString(),
      meta: { isChild: row.isChild, isGuardian: row.isGuardian, birthDate: row.birthDate },
    }));
    return paginate(domain, rows, cursor, limit);
  }
  if (domain === "stories") {
    const rows = (await listStories(context.familyId)).map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: `${row.periodStart.toISOString().slice(0, 10)} — ${row.periodEnd.toISOString().slice(0, 10)}`,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
      meta: { kind: row.kind, paragraphCount: row.paragraphCount },
    }));
    return paginate(domain, rows.reverse(), cursor, limit);
  }
  if (domain === "capsules") {
    const people = await listPeople(context.familyId);
    const childBirthDate = people.find((entry) => entry.isChild)?.birthDate ?? null;
    const rows = (await listCapsules(createContributionAccessSnapshot(context), childBirthDate)).map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: row.countdownLabel,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
      meta: { unlocked: row.unlocked, itemCount: row.itemCount, unlockType: row.unlockType, unlockValue: row.unlockValue },
    }));
    return paginate(domain, rows, cursor, limit);
  }
  if (domain === "requests") {
    const rows = listContributionRequests(context).map((row) => ({
      id: row.id,
      title: row.promptText,
      subtitle: row.recipientLabel,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
      meta: { submissionCount: row.submissionCount, pendingCount: row.pendingCount, expiresAt: row.expiresAt.toISOString() },
    }));
    return paginate(domain, rows, cursor, limit);
  }
  if (domain === "portals") {
    const rows = listContributionPortals(context).map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: row.description,
      status: row.status,
      updatedAt: row.createdAt.toISOString(),
      meta: { submissionCount: row.submissionCount, pendingCount: row.pendingCount, maxSubmissions: row.maxSubmissions, expiresAt: row.expiresAt.toISOString() },
    }));
    return paginate(domain, rows, cursor, limit);
  }
  const page = await listImportSessions(context.familyId, { cursor, limit });
  return {
    items: page.sessions.map((row) => ({
      id: row.id,
      title: row.defaultTitle || `导入 ${row.totalCount} 项`,
      subtitle: row.source,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
      meta: { totalCount: row.totalCount, completedCount: row.completedCount, failedCount: row.failedCount },
    })),
    nextCursor: page.nextCursor,
  };
}

export async function getMobileLibraryDetail(
  context: FamilyContext,
  domain: MobileLibraryDomain,
  id: string,
): Promise<Record<string, unknown> | null> {
  if (domain === "people") {
    const profile = await getPersonProfile(context, id);
    return profile ? {
      id: profile.person.id,
      title: profile.person.displayName,
      relationToChild: profile.person.relationToChild,
      birthDate: profile.person.birthDate,
      isChild: profile.person.isChild,
      memories: profile.participatingMemories.slice(0, 24).map((entry) => ({
        id: entry.event.id, title: entry.event.title, occurredAt: entry.event.occurredAt.toISOString(),
      })),
      narratives: profile.narratives.map((entry) => ({
        id: entry.id, memoryEventId: entry.memoryEventId, memoryTitle: entry.memoryTitle,
        text: entry.text, visibility: entry.visibility,
      })),
      requests: profile.oralHistoryRequests.map((entry) => ({
        id: entry.id, promptText: entry.promptText, status: entry.status,
        submissionCount: entry.submissionCount, pendingCount: entry.pendingCount,
      })),
      canWrite: hasFamilyCapability(context.role, "family:manage"),
    } : null;
  }
  if (domain === "stories") {
    const detail = await getStory(context.familyId, id);
    return detail ? {
      id: detail.story.id,
      title: detail.story.title,
      kind: detail.story.kind,
      status: detail.story.status,
      periodStart: detail.story.periodStart.toISOString(),
      periodEnd: detail.story.periodEnd.toISOString(),
      paragraphs: detail.paragraphs.map((entry) => ({
        id: entry.id, kind: entry.kind, text: entry.text,
        sources: entry.sources.map((source) => ({ type: source.sourceType, id: source.sourceId })),
      })),
      canWrite: hasFamilyCapability(context.role, "story:write") && detail.story.status !== "published",
    } : null;
  }
  if (domain === "capsules") {
    const people = await listPeople(context.familyId);
    const childBirthDate = people.find((entry) => entry.isChild)?.birthDate ?? null;
    const detail = await getCapsuleDetail(createContributionAccessSnapshot(context), id, childBirthDate);
    return detail ? {
      id: detail.capsule.id,
      title: detail.capsule.title,
      status: detail.capsule.status,
      unlockType: detail.capsule.unlockType,
      unlockValue: detail.capsule.unlockValue,
      unlocked: detail.unlocked,
      // Locked capsules deliberately return no content from the domain service.
      events: detail.events.map((entry) => ({ id: entry.id, title: entry.title, occurredAt: entry.occurredAt.toISOString() })),
      assets: detail.assets.map((entry) => ({ id: entry.id, filename: entry.originalFilename, type: entry.type })),
      contributions: detail.contributions.map((entry) => ({ id: entry.id, authorName: entry.authorName, text: entry.editedText ?? entry.rawText ?? entry.transcript ?? "" })),
      canWrite: hasFamilyCapability(context.role, "capsule:write"),
    } : null;
  }
  if (domain === "requests") {
    const row = listContributionRequests(context).find((entry) => entry.id === id);
    return row ? {
      id: row.id, title: row.promptText, recipientLabel: row.recipientLabel,
      status: row.status, expiresAt: row.expiresAt.toISOString(),
      submissionCount: row.submissionCount, pendingCount: row.pendingCount,
      canWrite: hasFamilyCapability(context.role, "contribution:create"),
    } : null;
  }
  if (domain === "portals") {
    const row = listContributionPortals(context).find((entry) => entry.id === id);
    if (!row) return null;
    const bundles = hasFamilyCapability(context.role, "contribution:create")
      ? listPortalSubmissionBundles(context, id)
      : [];
    return {
      id: row.id, title: row.title, description: row.description,
      status: row.status, expiresAt: row.expiresAt.toISOString(),
      submissionCount: row.submissionCount, pendingCount: row.pendingCount,
      bundles: bundles.map((entry) => ({
        id: entry.id, guestDisplayName: entry.guestDisplayName,
        status: entry.status, createdAt: entry.createdAt.toISOString(),
      })),
      canWrite: hasFamilyCapability(context.role, "contribution:create"),
    };
  }
  const detail = await getImportSessionDetail(context.familyId, id);
  return detail ? {
    id: detail.session.id,
    title: detail.session.defaultTitle || `导入 ${detail.session.totalCount} 项`,
    source: detail.session.source,
    status: detail.session.status,
    totalCount: detail.session.totalCount,
    completedCount: detail.session.completedCount,
    failedCount: detail.session.failedCount,
    items: detail.items.map(({ item, upload }) => ({
      id: item.id, captureId: item.captureId, filename: item.filename ?? upload?.filename ?? null,
      status: item.status, errorCode: item.errorCode, uploadId: upload?.id ?? null,
      receivedBytes: upload?.receivedBytes ?? 0, totalBytes: item.totalBytes ?? upload?.totalBytes ?? 0,
    })),
    canWrite: hasFamilyCapability(context.role, "capture:create"),
  } : null;
}
