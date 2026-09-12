import type { Credentials, MobileMemory, MobileMemoryPatch } from "../types";
import { isOccurredAtPrecision, type OccurredAtPrecision } from "../utils/occurred-precision";
import { utcToZonedWallTimeInput } from "../utils/wall-time";

export type MemoryEditContent = {
  title: string;
  bodyText: string;
  location: string;
  occurredAt: string | null;
  precision: OccurredAtPrecision;
  participants: string[];
  child: string | null;
};
export type MemoryEditSubmission = {
  mutationId: string;
  content: MemoryEditContent;
  expectedRevision: number;
};
export type LocalMemoryEdit = {
  scope: string;
  memoryId: string;
  content: MemoryEditContent;
  base: MemoryEditContent;
  baseRevision: number;
  timezone: string;
  /** Only explicitly saved content may be sent; typing itself stays local. */
  savedContent: MemoryEditContent | null;
  submission: MemoryEditSubmission | null;
  conflict: { content: MemoryEditContent; revision: number } | null;
  blocked: boolean;
  problem: string | null;
  revision: number;
  updatedAt: string;
};

/** Durable account ownership survives token renewal, never crosses instances. */
export function memoryEditScope(credentials: Credentials | null, userId?: string, familyId?: string): string | null {
  return credentials?.instanceId && userId && familyId
    ? JSON.stringify([credentials.serverUrl, credentials.instanceId, userId, familyId]) : null;
}

export function memoryEditContent(memory: MobileMemory): MemoryEditContent {
  if (memory.bodyText === undefined || memory.titleRevision === undefined || !isOccurredAtPrecision(memory.occurredAtPrecision)) {
    throw new Error("请先联网读取这段回忆，再修改内容。");
  }
  return { title: memory.title, bodyText: memory.bodyText, location: memory.locationText ?? "",
    occurredAt: memory.occurredAtPrecision === "unknown" ? null : memory.occurredAt,
    precision: memory.occurredAtPrecision, participants: memory.participantPersonIds, child: memory.childPersonId };
}

export function sameMemoryEdit(a: MemoryEditContent | null, b: MemoryEditContent | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function memoryEditPatch(submission: MemoryEditSubmission, timezone: string): MobileMemoryPatch {
  const content = submission.content;
  const wall = content.occurredAt ? utcToZonedWallTimeInput(new Date(content.occurredAt), timezone) : undefined;
  return { mutationId: submission.mutationId, expectedRevision: submission.expectedRevision,
    title: content.title, bodyText: content.bodyText, locationText: content.location || null,
    occurredAtPrecision: content.precision,
    occurredAtWall: content.precision === "unknown" ? undefined : content.precision === "year" ? wall?.slice(0, 4)
      : content.precision === "month" ? wall?.slice(0, 7) : content.precision === "date_only" ? wall?.slice(0, 10) : wall,
    participantPersonIds: content.participants, childPersonId: content.child };
}
