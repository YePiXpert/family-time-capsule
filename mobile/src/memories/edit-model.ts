import type { DraftContent, DraftItem } from "../drafts/model";
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
  items?: DraftItem[];
  visibility?: "private" | "members" | "family";
  readerUserIds?: string[];
  coverAssetId?: string | null;
  newCoverItemId?: string | null;
  milestoneType?: string | null;
};
export type MemoryEditSubmission = {
  mutationId: string;
  content: MemoryEditContent;
  expectedRevision: number;
  stage?: { id: string; mutationId: string; revision: number | null; items: DraftItem[]; uploads?: Record<string, { id: string; offset: number }> };
};
export type LocalMemoryEdit = {
  scope: string;
  memoryId: string;
  content: MemoryEditContent;
  base: MemoryEditContent;
  baseRevision: number;
  timezone: string;
  atomicEditVersion?: 1;
  appliedItemIds?: string[];
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
    precision: memory.occurredAtPrecision, participants: memory.participantPersonIds, child: memory.childPersonId,
    ...(memory.atomicEditVersion === 1 ? { items: [], visibility: memory.visibility ?? "private", readerUserIds: memory.readerUserIds ?? [], coverAssetId: memory.coverAssetId ?? null, milestoneType: memory.milestoneType ?? null } : {}) };
}

export function sameMemoryEdit(a: MemoryEditContent | null, b: MemoryEditContent | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function memoryEditPatch(submission: MemoryEditSubmission, timezone: string): MobileMemoryPatch {
  const content = submission.content;
  const wall = content.occurredAt ? utcToZonedWallTimeInput(new Date(content.occurredAt), timezone) : undefined;
  return { mutationId: submission.mutationId, expectedRevision: submission.expectedRevision,
    title: content.title.trim() || content.bodyText.trim().split("\n")[0]!.slice(0, 100) || "这一刻", bodyText: content.bodyText, locationText: content.location || null,
    occurredAtPrecision: content.precision,
    occurredAtWall: content.precision === "unknown" ? undefined : content.precision === "year" ? wall?.slice(0, 4)
      : content.precision === "month" ? wall?.slice(0, 7) : content.precision === "date_only" ? wall?.slice(0, 10) : wall,
    participantPersonIds: content.participants, childPersonId: content.child,
    ...(content.visibility ? { visibility: content.visibility, readerUserIds: content.visibility === "members" ? content.readerUserIds ?? [] : [] } : {}),
    ...(content.newCoverItemId ? { coverAssetId: submission.stage?.items.find(item => item.id === content.newCoverItemId)?.assetId ?? (() => { throw new Error("新封面尚未上传完成。"); })() } : content.coverAssetId !== undefined ? { coverAssetId: content.coverAssetId } : {}),
    ...(content.milestoneType !== undefined ? { milestoneType: content.milestoneType } : {}),
    ...(submission.stage ? { editDraftId: submission.stage.id, editDraftRevision: submission.stage.revision!, appendItems: submission.stage.items } : {}) };
}

/** The composer uses the same field model for a new record and a memory edit. */
export function memoryEditDraft(content: MemoryEditContent): DraftContent {
  return { title: content.title, text: content.bodyText, locationText: content.location,
    occurredAt: content.occurredAt, occurredAtPrecision: content.precision, participantIds: content.participants,
    visibility: content.visibility ?? "private", readerUserIds: content.readerUserIds ?? [],
    coverItemId: content.newCoverItemId ?? null, items: content.items ?? [] };
}
export function applyMemoryDraft(content: MemoryEditContent, patch: Partial<DraftContent>): MemoryEditContent {
  const draft = { ...memoryEditDraft(content), ...patch };
  return { ...content, title: draft.title, bodyText: draft.text, location: draft.locationText,
    occurredAt: draft.occurredAt, precision: draft.occurredAtPrecision, participants: draft.participantIds,
    items: draft.items, visibility: draft.visibility, readerUserIds: draft.readerUserIds, newCoverItemId: draft.coverItemId };
}
