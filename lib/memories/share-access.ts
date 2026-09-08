import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { asset } from "@/db/schema/asset";
import { contribution } from "@/db/schema/contribution";
import { user } from "@/db/schema/auth";
import { family, person } from "@/db/schema/family";
import { memoryEventAsset } from "@/db/schema/memory";
import { canManageOriginalInTransaction } from "@/lib/authz/asset-management";
import { createContributionAccessSnapshot, getVisibleContributionInTransaction, readableAssetPredicate, type ContributionAccessTransaction } from "@/lib/authz/contribution-access";
import { isFamilyRole, type EventVisibility } from "@/lib/authz/policy";
import type { FamilyContext } from "@/lib/family/context";

/** Throwing rolls back provisional event/readers changes before they can commit. */
export class MemoryShareSourceError extends Error {}

/** Called inside the sharing transaction, after provisional reader changes. */
export function assertMemoryShareSources(tx: ContributionAccessTransaction, context: FamilyContext,
  event: { id: string; coverAssetId: string | null }, visibility: EventVisibility, addedReaderIds: string[]) {
  const links = tx.select().from(memoryEventAsset).where(and(eq(memoryEventAsset.familyId, context.familyId), eq(memoryEventAsset.memoryEventId, event.id))).all();
  const assetIds = new Set([...links.map(link => link.assetId), ...(event.coverAssetId ? [event.coverAssetId] : [])]);
  const requireOriginal = (assetId: string) => {
    const root = tx.select().from(asset).where(and(eq(asset.familyId, context.familyId), isNull(asset.originalAssetId), sql`${asset.id} in (
      with recursive chain(id, parent_id) as (
        select id, original_asset_id from asset where id = ${assetId} and family_id = ${context.familyId}
        union select a.id, a.original_asset_id from asset a join chain c on a.id = c.parent_id where a.family_id = ${context.familyId}
      ) select id from chain where parent_id is null
    )`)).get();
    if (!root || !canManageOriginalInTransaction(tx, context, root)) throw new MemoryShareSourceError();
  };
  for (const assetId of assetIds) requireOriginal(assetId);
  const sources = tx.select().from(contribution).where(and(eq(contribution.memoryEventId, event.id), isNull(contribution.deletedAt))).all();
  const currentFamily = tx.select().from(family).where(eq(family.id, context.familyId)).get();
  if (!currentFamily) throw new MemoryShareSourceError();
  const readers = addedReaderIds.length ? tx.select({ account: user, person }).from(user).leftJoin(person, and(eq(person.id, user.personId), eq(person.familyId, context.familyId)))
    .where(and(eq(user.familyId, context.familyId), inArray(user.id, addedReaderIds), isNull(user.disabledAt))).all().map(({ account, person }) => {
      if (!isFamilyRole(account.role) || (account.personId !== null && !person)) throw new MemoryShareSourceError();
      return { userId: account.id, userName: account.name, familyId: context.familyId, personId: account.personId,
        role: account.role, accountEnabled: true, isGuardian: person?.isGuardian ?? false,
        familyTimezone: currentFamily.timezone, childLaterUnlockAge: currentFamily.childLaterUnlockAge } satisfies FamilyContext;
    }) : [];
  for (const source of sources) {
    // Private words still belong solely to their author; sharing the parent cannot publish them.
    if (source.visibility === "private") continue;
    const exposed = visibility === "family" || readers.some(reader => reader.personId !== source.authorPersonId &&
      getVisibleContributionInTransaction(tx, createContributionAccessSnapshot(reader), source.id));
    if (!exposed) continue;
    if (source.authorPersonId !== context.personId) throw new MemoryShareSourceError();
    if (source.audioAssetId) requireOriginal(source.audioAssetId);
  }
  if (event.coverAssetId && !attachMemoryCoverInTransaction(tx, context, event.id, event.coverAssetId)) throw new MemoryShareSourceError();
}

/** Selecting a new cover includes that original in the memory after a fresh reshare check.
 * Historical cover ids alone never become media grants. Caller has checked event management.
 */
export function attachMemoryCoverInTransaction(tx: ContributionAccessTransaction, context: FamilyContext, eventId: string, coverAssetId: string): boolean {
  if (tx.select({ id: memoryEventAsset.id }).from(memoryEventAsset).where(and(eq(memoryEventAsset.memoryEventId, eventId), eq(memoryEventAsset.familyId, context.familyId), eq(memoryEventAsset.assetId, coverAssetId))).get()) return true;
  const cover = tx.select().from(asset).where(and(eq(asset.id, coverAssetId), eq(asset.familyId, context.familyId), readableAssetPredicate(createContributionAccessSnapshot(context), sql`${asset.id}`))).get();
  if (!cover || !canManageOriginalInTransaction(tx, context, cover)) return false;
  const last = tx.select({ order: sql<number>`coalesce(max(${memoryEventAsset.sortOrder}), -1)` }).from(memoryEventAsset).where(and(eq(memoryEventAsset.memoryEventId, eventId), eq(memoryEventAsset.familyId, context.familyId))).get();
  tx.insert(memoryEventAsset).values({ id: randomUUID(), familyId: context.familyId, memoryEventId: eventId, assetId: coverAssetId, sortOrder: (last?.order ?? -1) + 1 }).run();
  return true;
}
