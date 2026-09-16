import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { draft, draftItem } from "@/db/schema/draft";
import { uploadSession } from "@/db/schema/import";
import { asset } from "@/db/schema/asset";
import { memoryEventAsset } from "@/db/schema/memory";
import { canManageOriginalInTransaction } from "@/lib/authz/asset-management";
import { createContributionAccessSnapshot, getContributionAssetAccessInTransaction, type ContributionAccessTransaction } from "@/lib/authz/contribution-access";
import { emptyDraftContent, parseDraftContent, type DraftItem } from "@/lib/drafts/model";
import type { FamilyContext } from "@/lib/family/context";

export class MemoryEditStagingError extends Error {
  constructor(readonly code: "bad_asset" | "edit_draft_conflict" | "asset_reshare_forbidden") { super(code); }
}

export function parseAppendItems(value: unknown): DraftItem[] {
  const parsed = parseDraftContent({ ...emptyDraftContent(), visibility: "private", items: value });
  if (parsed.items.some(item => !item.assetId || item.preservationState)) throw new Error("invalid_append_items");
  return parsed.items;
}

/** Validate upload receipts, authorship, sources and exact staged item metadata before any write. */
export function validateEditStaging(tx: ContributionAccessTransaction, context: FamilyContext, eventId: string,
  draftId: string, revision: number, items: DraftItem[]) {
  const stage = tx.select().from(draft).where(and(eq(draft.id, draftId), eq(draft.familyId, context.familyId), eq(draft.authorUserId, context.userId))).get();
  if (!stage || stage.purpose !== "memory_edit" || stage.editTargetMemoryId !== eventId || stage.status !== "editing" ||
    stage.revision !== revision || stage.visibility !== "private" || stage.readerUserIdsJson !== "[]" || stage.inboxItemId || stage.memoryEventId) throw new MemoryEditStagingError("edit_draft_conflict");
  const staged = tx.select().from(draftItem).where(eq(draftItem.draftId, draftId)).orderBy(asc(draftItem.sortOrder)).all();
  if (staged.length !== items.length) throw new MemoryEditStagingError("edit_draft_conflict");
  const snapshot = createContributionAccessSnapshot(context);
  const oldLinks = tx.select().from(memoryEventAsset).where(and(eq(memoryEventAsset.familyId, context.familyId), eq(memoryEventAsset.memoryEventId, eventId))).all();
  for (const [index, item] of items.entries()) {
    const originalItem = staged[index]!;
    if (originalItem.id !== item.id || originalItem.localCaptureRef !== item.localCaptureRef || originalItem.caption !== item.caption ||
      (originalItem.livePhotoGroupId ?? undefined) !== item.livePhotoGroupId || (originalItem.livePhotoRole ?? undefined) !== item.livePhotoRole ||
      (originalItem.assetId && originalItem.assetId !== item.assetId)) throw new MemoryEditStagingError("edit_draft_conflict");
    if (originalItem.localCaptureRef) {
      const receipt = tx.select({ id: uploadSession.id }).from(uploadSession).where(and(eq(uploadSession.familyId, context.familyId),
        eq(uploadSession.userId, context.userId), eq(uploadSession.draftId, draftId), eq(uploadSession.captureId, originalItem.localCaptureRef),
        eq(uploadSession.status, "completed"), eq(uploadSession.finalAssetId, item.assetId!))).get();
      if (!receipt) throw new MemoryEditStagingError("bad_asset");
    } else if (!originalItem.assetId) throw new MemoryEditStagingError("bad_asset");
    const original = tx.select().from(asset).where(and(eq(asset.id, item.assetId!), eq(asset.familyId, context.familyId), isNull(asset.originalAssetId))).get();
    if (!original || !getContributionAssetAccessInTransaction(tx, snapshot, original.id).readable ||
      (item.livePhotoRole && original.type !== item.livePhotoRole) || oldLinks.some(link => link.assetId === original.id || (item.livePhotoGroupId && link.livePhotoGroupId === item.livePhotoGroupId))) throw new MemoryEditStagingError("bad_asset");
    if (!canManageOriginalInTransaction(tx, context, original)) throw new MemoryEditStagingError("asset_reshare_forbidden");
  }
  return stage;
}
