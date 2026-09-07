import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { asset } from "@/db/schema/asset";
import { assetDeletion } from "@/db/schema/asset-deletion";
import { user } from "@/db/schema/auth";
import { hasFamilyCapability, isAdminClassRole } from "@/lib/authz/policy";
import type { ContributionAccessTransaction as Tx } from "@/lib/authz/contribution-access";
import type { FamilyContext } from "@/lib/family/context";
import { AssetLibraryError, getLibraryAsset } from "./library";
import { getAssetStorage } from "./storage";

/** Every FK is a user reference unless explicitly classified as disposable
 * processing state or an import receipt. New schema references fail closed. */
const disposable = new Set([
  "asset.original_asset_id", "asset_analysis.asset_id", "asset_transcript.asset_id",
  "document_text.asset_id", "media_job.asset_id", "media_job.output_asset_id",
  "upload_session.final_asset_id", "import_session_item.asset_id", "inbox_item_asset.asset_id",
]);
const identifier = (s: string) => sql.raw(`"${s.replaceAll('"', '""')}"`);
function assertUnreferenced(tx: Tx, ids: string[]) {
  const json = JSON.stringify(ids);
  const tables = tx.all<{ name: string }>(sql`select name from sqlite_master where type='table' and name not like 'sqlite_%'`);
  for (const table of tables) {
    const keys = tx.all<{ table: string; from: string }>(sql`select "table", "from" from pragma_foreign_key_list(${table.name})`);
    for (const key of keys) if (key.table === "asset" && !disposable.has(`${table.name}.${key.from}`)) {
      if (tx.get(sql`select 1 from ${identifier(table.name)} where ${identifier(key.from)} in (select value from json_each(${json})) limit 1`)) throw new AssetLibraryError("asset_in_use", 409);
    }
  }
  // Historical avatar pointers predate FKs.
  if (tx.get(sql`select 1 from person where avatar_asset_id in (select value from json_each(${json})) limit 1`)) throw new AssetLibraryError("asset_in_use", 409);
  // A confirmed intake remains provenance even if its event link was damaged.
  if (tx.get(sql`select 1 from inbox_item i join inbox_item_asset a on a.inbox_item_id=i.id where a.asset_id in (select value from json_each(${json})) and (i.status='confirmed' or i.memory_event_id is not null) limit 1`)) throw new AssetLibraryError("asset_in_use", 409);
}
function authorize(tx: Tx, ctx: FamilyContext, owner: string | null) {
  const live = tx.select().from(user).where(and(eq(user.id, ctx.userId), eq(user.familyId, ctx.familyId), eq(user.role, ctx.role), isNull(user.disabledAt))).get();
  if (!live || live.personId !== ctx.personId || !hasFamilyCapability(ctx.role, "event:write") || (!isAdminClassRole(ctx.role) && ctx.userId !== owner)) throw new AssetLibraryError("forbidden", 403);
}
export function deleteLibraryAsset(ctx: FamilyContext, id: string, confirmed: boolean): { deleted: true; cleanupPending: boolean } {
  if (confirmed !== true) throw new AssetLibraryError("confirmation_required");
  getDb().transaction(tx => {
    const receipt = tx.select().from(assetDeletion).where(and(eq(assetDeletion.assetId, id), eq(assetDeletion.familyId, ctx.familyId))).get();
    if (receipt) { authorize(tx, ctx, receipt.requestedByUserId); return; }
    getLibraryAsset(ctx, id); // Same live read policy as opening the original.
    const original = tx.select().from(asset).where(and(eq(asset.id, id), eq(asset.familyId, ctx.familyId), isNull(asset.originalAssetId))).get();
    if (!original) throw new AssetLibraryError("not_found", 404);
    authorize(tx, ctx, original.createdByUserId);
    const tree = tx.all<{ id: string; storage_key: string; family_id: string }>(sql`with recursive tree(id) as (select ${id} union select a.id from asset a join tree on a.original_asset_id=tree.id) select a.id,a.storage_key,a.family_id from asset a join tree on a.id=tree.id`);
    if (tree.some(a => a.family_id !== ctx.familyId)) throw new AssetLibraryError("asset_in_use", 409);
    const ids = tree.map(a => a.id), json = JSON.stringify(ids);
    assertUnreferenced(tx, ids);
    const now = new Date().toISOString();
    tx.insert(assetDeletion).values({ assetId: id, familyId: ctx.familyId, sha256: original.sha256, deletedAt: now, requestedByUserId: ctx.userId, storageKeysJson: JSON.stringify(tree.map(a => a.storage_key)) }).run();
    const intake = tx.all<{ id: string }>(sql`select distinct inbox_item_id id from inbox_item_asset where asset_id in (select value from json_each(${json}))`);
    tx.run(sql`delete from inbox_item_asset where asset_id in (select value from json_each(${json}))`);
    for (const row of intake) tx.run(sql`update inbox_item set title_revision=title_revision+1, updated_at=unixepoch(), status=case when not exists(select 1 from inbox_item_asset where inbox_item_id=${row.id}) and coalesce(trim(raw_text),'')='' then 'discarded' else status end where id=${row.id}`);
    // This removes all media access before touching the filesystem. CAS/family
    // checks in workers reject late commits after their source disappears.
    tx.run(sql`delete from asset where id in (select value from json_each(${json}))`);
  }, { behavior: "immediate" });
  return cleanReceipt(ctx, id);
}
function cleanReceipt(ctx: FamilyContext, id: string) {
  // Serialize cleanup/retries with writers. A failure commits the remaining
  // private paths, so process death and a second DELETE safely resume it.
  return getDb().transaction(tx => {
    const receipt = tx.select().from(assetDeletion).where(and(eq(assetDeletion.assetId, id), eq(assetDeletion.familyId, ctx.familyId))).get()!;
    authorize(tx, ctx, receipt.requestedByUserId);
    const pending: string[] = [];
    for (const key of JSON.parse(receipt.storageKeysJson) as string[]) {
      try { getAssetStorage().delete(key); } catch { pending.push(key); }
    }
    tx.update(assetDeletion).set({ storageKeysJson: JSON.stringify(pending), cleanedAt: pending.length ? null : receipt.cleanedAt ?? new Date().toISOString() }).where(eq(assetDeletion.assetId, id)).run();
    return { deleted: true as const, cleanupPending: pending.length > 0 };
  }, { behavior: "immediate" });
}
