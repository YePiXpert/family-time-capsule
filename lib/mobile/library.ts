import "server-only";

import type { FamilyContext } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { listPeople } from "@/lib/family/service";
import { getPersonProfile } from "@/lib/family/profile";

import { getImportSessionDetail, listImportSessions } from "@/lib/imports/service";

export const MOBILE_LIBRARY_DOMAINS = [
  "people",
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

  const page = await listImportSessions(context.familyId, { cursor, limit, actorUserId: context.userId });
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
      voices: profile.voices.map(voice => ({ ...voice, createdAt: voice.createdAt.toISOString() })),
      narratives: profile.narratives.map((entry) => ({
        id: entry.id, memoryEventId: entry.memoryEventId, memoryTitle: entry.memoryTitle,
        text: entry.text, visibility: entry.visibility,
      })),

      canWrite: hasFamilyCapability(context.role, "family:manage"),
    } : null;
  }

  const detail = await getImportSessionDetail(context.familyId, id, context.userId);
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
