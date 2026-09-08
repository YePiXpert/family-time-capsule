import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { asset } from "@/db/schema/asset";
import { assetDeletion } from "@/db/schema/asset-deletion";
import { user } from "@/db/schema/auth";
import { person } from "@/db/schema/family";
import { memoryEvent, memoryEventAsset } from "@/db/schema/memory";
import { hasFamilyCapability, isAdminClassRole, canManageEventVisibility, isEventVisibility } from "@/lib/authz/policy";
import { createContributionAccessSnapshot, readableAssetPredicate, type ContributionAccessTransaction as Tx } from "@/lib/authz/contribution-access";
import { canManageOriginalInTransaction } from "@/lib/authz/asset-management";
import { createEventAccessSnapshot, eventVisibilityCondition } from "@/lib/authz/event-access";
import type { FamilyContext } from "@/lib/family/context";
import { readableName } from "@/lib/naming";
import { emptyDraftContent } from "@/lib/drafts/model";
import { getDraft, saveDraft } from "@/lib/drafts/service";
import { indexDocumentAssetsForEvent } from "@/lib/search/service";
import type { LibraryAsset, LibraryDetail, LibraryPage } from "@/mobile/src/assets/types";
export class AssetLibraryError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
function authorize(tx: Tx, ctx: FamilyContext, capability: "archive:view" | "event:write" | "capture:create" = "archive:view") {
  if (!hasFamilyCapability(ctx.role, capability)) throw new AssetLibraryError("forbidden", 403);
  const actor = tx.select().from(user).where(and(eq(user.id, ctx.userId), eq(user.familyId, ctx.familyId), eq(user.role, ctx.role), isNull(user.disabledAt))).get();
  if (!actor || actor.personId !== ctx.personId) throw new AssetLibraryError("forbidden", 403);
}
function find(tx: Tx, ctx: FamilyContext, id: string) {
  const row = tx.select().from(asset).where(and(eq(asset.id, id), eq(asset.familyId, ctx.familyId), isNull(asset.originalAssetId), readableAssetPredicate(createContributionAccessSnapshot(ctx), sql`${asset.id}`))).get();
  if (!row) throw new AssetLibraryError("not_found", 404);
  return row;
}
function card(tx: Tx, ctx: FamilyContext, row: typeof asset.$inferSelect): LibraryAsset {
  const preview = tx.get<{ id: string }>(sql`select id from asset where original_asset_id=${row.id} and family_id=${ctx.familyId} and derivative_type='thumbnail' order by created_at desc,id desc limit 1`);
  const referenced = tx.get(sql`select 1 from memory_event_asset ma join memory_event e on e.id=ma.memory_event_id where ma.asset_id=${row.id} and ma.family_id=${ctx.familyId} and e.family_id=${ctx.familyId} and e.deleted_at is null and ${eventVisibilityCondition(createEventAccessSnapshot(ctx), sql`e`)} limit 1`);
  const ai = tx.get<{ status: string }>(sql`select status from ai_job where family_id=${ctx.familyId} and entity_type='asset' and entity_id=${row.id} order by created_at desc,rowid desc limit 1`);
  return { id: row.id, title: readableName({ title: row.displayName, source: row.nameSource, mediaType: row.type, originalFilename: row.originalFilename, capturedAt: row.capturedAt, timeSource: row.timeSource, durationMs: row.durationMs, timezone: ctx.familyTimezone }).text, type: row.type as LibraryAsset["type"], mimeType: row.mimeType, previewId: row.type === "image" ? preview?.id ?? row.id : null, capturedAt: ["user_confirmed", "embedded_metadata"].includes(row.timeSource) ? row.capturedAt?.toISOString() ?? null : null, referenced: Boolean(referenced), syncState: "received", aiState: ai?.status ?? "none" };
}
export function listLibraryAssets(ctx: FamilyContext, options: { cursor?: string | null; type?: string | null; limit?: number } = {}): LibraryPage {
  const limit = Math.min(100, Math.max(1, options.limit ?? 30));
  let cursor: { at: number; id: string } | null = null;
  if (options.cursor) {
    try { cursor = JSON.parse(Buffer.from(options.cursor, "base64url").toString()); if (!cursor || !Number.isSafeInteger(cursor.at) || typeof cursor.id !== "string" || cursor.id.length > 128) throw new Error(); }
    catch { throw new AssetLibraryError("invalid_cursor"); }
  }
  if (options.type && !["image", "audio", "video", "document"].includes(options.type)) throw new AssetLibraryError("invalid_type");
  return getDb().transaction(tx => {
    authorize(tx, ctx);
    const rows = tx.select().from(asset).where(and(eq(asset.familyId, ctx.familyId), isNull(asset.originalAssetId), readableAssetPredicate(createContributionAccessSnapshot(ctx), sql`${asset.id}`), options.type ? eq(asset.type, options.type) : undefined, cursor ? sql`(${asset.createdAt},${asset.id}) < (${cursor.at},${cursor.id})` : undefined)).orderBy(desc(asset.createdAt), desc(asset.id)).limit(limit + 1).all();
    const page = rows.slice(0, limit), last = page.at(-1);
    const pendingDeletions = hasFamilyCapability(ctx.role, "event:write") ? tx.select({ id: assetDeletion.assetId }).from(assetDeletion).where(and(eq(assetDeletion.familyId, ctx.familyId), isNull(assetDeletion.cleanedAt), isAdminClassRole(ctx.role) ? undefined : eq(assetDeletion.requestedByUserId, ctx.userId))).limit(100).all() : [];
    return { pendingDeletions, entries: page.map(row => card(tx, ctx, row)), nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ at: last.createdAt.getTime() / 1000, id: last.id })).toString("base64url") : null, canWrite: hasFamilyCapability(ctx.role, "event:write"), canCapture: hasFamilyCapability(ctx.role, "capture:create") };
  });
}
export function getLibraryAsset(ctx: FamilyContext, id: string): LibraryDetail {
  return getDb().transaction(tx => {
    authorize(tx, ctx);
    const row = find(tx, ctx, id);
    const memories = tx.select({ id: memoryEvent.id, title: memoryEvent.title }).from(memoryEventAsset).innerJoin(memoryEvent, eq(memoryEvent.id, memoryEventAsset.memoryEventId)).where(and(eq(memoryEventAsset.assetId, id), eq(memoryEvent.familyId, ctx.familyId), isNull(memoryEvent.deletedAt), eventVisibilityCondition(createEventAccessSnapshot(ctx)))).all();
    const sources = tx.all<{ source: string }>(sql`select distinct source from upload_session where family_id=${ctx.familyId} and final_asset_id=${id} union select distinct s.source from import_session_item i join import_session s on s.id=i.import_session_id where i.family_id=${ctx.familyId} and i.asset_id=${id}`);
    const canManage = canManageOriginalInTransaction(tx, ctx, row);
    return { ...card(tx, ctx, row), canDelete: canManage && hasFamilyCapability(ctx.role, "event:write") && (isAdminClassRole(ctx.role) || ctx.userId === row.createdByUserId), metadataRevision: row.metadataRevision, nameRevision: row.nameRevision, participantIds: JSON.parse(row.participantIdsJson), canWrite: canManage && hasFamilyCapability(ctx.role, "event:write"), canCapture: hasFamilyCapability(ctx.role, "capture:create"), memories, technical: { importSources: sources.map(s => s.source), originalFilename: row.originalFilename, sha256: row.sha256, bytes: row.bytes, width: row.width, height: row.height, durationMs: row.durationMs, metadataJson: row.metadataJson, importedAt: row.importedAt.toISOString(), timeSource: row.timeSource } };
  });
}
export function editLibraryAsset(ctx: FamilyContext, id: string, revision: number, patch: { capturedAt?: string | null; participantIds?: string[] }) {
  if (!Number.isSafeInteger(revision) || revision < 0 || (patch.capturedAt !== undefined && patch.capturedAt !== null && (typeof patch.capturedAt !== "string" || !/^\d{4}-\d\d-\d\dT/.test(patch.capturedAt) || !Number.isFinite(Date.parse(patch.capturedAt))))) throw new AssetLibraryError("invalid_input");
  if (patch.participantIds !== undefined && (!Array.isArray(patch.participantIds) || patch.participantIds.length > 50 || patch.participantIds.some(id => typeof id !== "string") || new Set(patch.participantIds).size !== patch.participantIds.length)) throw new AssetLibraryError("invalid_people");
  getDb().transaction(tx => {
    authorize(tx, ctx, "event:write"); const row = find(tx, ctx, id);
    if (!canManageOriginalInTransaction(tx, ctx, row)) throw new AssetLibraryError("forbidden", 403);
    if (row.metadataRevision !== revision) throw new AssetLibraryError("revision_conflict", 409);
    const ids = patch.participantIds;
    if (ids?.length && tx.select().from(person).where(and(eq(person.familyId, ctx.familyId), inArray(person.id, ids))).all().length !== ids.length) throw new AssetLibraryError("invalid_people");
    tx.update(asset).set({ metadataRevision: revision + 1, ...(ids === undefined ? {} : { participantIdsJson: JSON.stringify(ids) }), ...(patch.capturedAt === undefined ? {} : { capturedAt: patch.capturedAt ? new Date(patch.capturedAt) : null, timeSource: patch.capturedAt ? "user_confirmed" : "import_time" }) }).where(eq(asset.id, id)).run();
  }, { behavior: "immediate" });
  return getLibraryAsset(ctx, id);
}
function originals(tx: Tx, ctx: FamilyContext, ids: string[]) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) throw new AssetLibraryError("invalid_assets");
  return ids.map(id => find(tx, ctx, id));
}
export function addLibraryAssetsToDraft(ctx: FamilyContext, ids: string[], draftId: string, expectedRevision: number, mutationId: string) {
  return getDb().transaction(tx => {
    authorize(tx, ctx, "capture:create"); originals(tx, ctx, ids);
    const current = expectedRevision ? getDraft(ctx, draftId) : null;
    const content = current ?? emptyDraftContent();
    const items = [...content.items, ...ids.filter(id => !content.items.some(item => item.assetId === id)).map(assetId => ({ id: randomUUID(), assetId, localCaptureRef: null, caption: "" }))];
    return saveDraft(ctx, draftId, expectedRevision, mutationId, { ...content, items, coverItemId: content.coverItemId ?? items[0]?.id ?? null });
  }, { behavior: "immediate" });
}
export function addLibraryAssetsToMemory(ctx: FamilyContext, ids: string[], memoryId: string) {
  getDb().transaction(tx => {
    authorize(tx, ctx, "event:write");
    const selected = originals(tx, ctx, ids);
    const event = tx.select().from(memoryEvent).where(and(eq(memoryEvent.id, memoryId), eq(memoryEvent.familyId, ctx.familyId), isNull(memoryEvent.deletedAt), eventVisibilityCondition(createEventAccessSnapshot(ctx)))).get();
    if (!event) throw new AssetLibraryError("not_found", 404);
    if (!isEventVisibility(event.visibility) || !canManageEventVisibility(event.visibility, event.createdByUserId, ctx)) throw new AssetLibraryError("forbidden", 403);
    if (selected.some(row => !canManageOriginalInTransaction(tx, ctx, row))) throw new AssetLibraryError("asset_reshare_forbidden", 403);
    const prior = tx.select().from(memoryEventAsset).where(eq(memoryEventAsset.memoryEventId, memoryId)).all();
    let sortOrder = Math.max(-1, ...prior.map(item => item.sortOrder)) + 1;
    for (const assetId of ids) if (!prior.some(item => item.assetId === assetId)) tx.insert(memoryEventAsset).values({ id: randomUUID(), familyId: ctx.familyId, memoryEventId: memoryId, assetId, sortOrder: sortOrder++ }).run();
    tx.update(memoryEvent).set({ coverAssetId: event.coverAssetId ?? ids[0], updatedAt: new Date(), titleRevision: event.titleRevision + 1, lastEditedByUserId: ctx.userId }).where(eq(memoryEvent.id, memoryId)).run();
  }, { behavior: "immediate" });
  indexDocumentAssetsForEvent(ctx.familyId, memoryId, ids);
}
