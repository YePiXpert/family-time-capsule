import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { user } from "@/db/schema/auth";
import { memoryEvent, memoryEventReader } from "@/db/schema/memory";
import { asset } from "@/db/schema/asset";
import { bookProject } from "@/db/schema/book";
import { importSession } from "@/db/schema/import";
import { inboxItemAsset } from "@/db/schema/inbox";
import { familyReviewAssetPredicate } from "@/lib/authz/contribution-access";
import { draft } from "@/db/schema/draft";
import { validateArchivePrivacy, type ArchivePrivacy } from "./privacy.mjs";
export function collectArchivePrivacy(familyId: string, rows: { events: (typeof memoryEvent.$inferSelect)[]; assets: (typeof asset.$inferSelect)[]; draftIds: Set<string>; bookIds: Set<string>; importIds: Set<string>; reviewAssetPairs: Set<string> }): ArchivePrivacy {
  const db = getDb(), principals = new Map<string, { id: string; name: string }>();
  function principal(userId: string | null, legacyKey?: string, legacyName = "待确认作者") {
    if (!userId && !legacyKey) return null;
    const key = userId ?? legacyKey!;
    if (!principals.has(key)) {
      const actor = userId ? db.select({ name: user.name }).from(user).where(eq(user.id, userId)).get() : undefined;
      if (userId && !actor) throw new Error("archive_principal_missing");
      principals.set(key, { id: randomUUID(), name: (actor?.name ?? legacyName).slice(0, 200) });
    }
    return principals.get(key)!.id;
  }
  const events = rows.events.map(row => ({ id: row.id, visibility: row.visibility, owner: principal(row.createdByUserId, row.visibility === "family" ? undefined : `event:${row.id}`), readers: row.visibility === "members" ? db.select().from(memoryEventReader).where(eq(memoryEventReader.memoryEventId, row.id)).all().map(r => principal(r.userId)!) : [] }));
  const assets = rows.assets.filter(row => !row.derivativeType).map(row => ({ id: row.id, visibility: row.visibility, owner: principal(row.createdByUserId) }));
  const drafts = db.select().from(draft).where(eq(draft.familyId, familyId)).all().filter(row => rows.draftIds.has(row.id)).map(row => ({ id: row.id, visibility: row.visibility, owner: principal(row.authorUserId, `draft:${row.id}`, row.authorName), readers: row.visibility === "members" ? (JSON.parse(row.readerUserIdsJson) as string[]).map(id => principal(id)!) : [] }));
  const books = db.select().from(bookProject).where(eq(bookProject.familyId, familyId)).all().filter(row => rows.bookIds.has(row.id)).map(row => ({ id: row.id, owner: principal(row.ownerUserId, row.audience === "personal" ? `book:${row.id}` : undefined) }));
  const imports = db.select().from(importSession).where(eq(importSession.familyId, familyId)).all().filter(row => rows.importIds.has(row.id)).map(row => ({ id: row.id, owner: principal(row.createdByUserId) }));
  const reviewAssets = db.select({ inboxItemId: inboxItemAsset.inboxItemId, assetId: inboxItemAsset.assetId }).from(inboxItemAsset).where(and(eq(inboxItemAsset.familyId, familyId), familyReviewAssetPredicate(familyId, sql`${inboxItemAsset.assetId}`))).all().filter(row => rows.reviewAssetPairs.has(`${row.inboxItemId}:${row.assetId}`));
  return validateArchivePrivacy({ version: 1, events, assets, drafts, books, imports, reviewAssets, principals: [...principals.values()] }, { events: new Set(events.map(r => r.id)), assets: new Set(assets.map(r => r.id)), drafts: rows.draftIds, books: rows.bookIds, imports: rows.importIds, reviewAssets: rows.reviewAssetPairs });
}
