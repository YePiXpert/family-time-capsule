import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { draft, draftItem } from "@/db/schema/draft";
import { parseDraftContent, type DraftContent } from "./model";
export type DraftArchive = DraftContent & { reviewPending?: boolean; id: string; inboxItemId: string | null; authorPersonId: string | null; authorName: string; status: "editing" | "published" | "discarded"; memoryEventId: string | null; createdAt: string; updatedAt: string };
export function collectDraftArchive(familyId: string, eventIds: Set<string>): DraftArchive[] {
  const db = getDb();
  return db.select().from(draft).where(eq(draft.familyId, familyId)).all().map(row => {
    const items = db.select().from(draftItem).where(eq(draftItem.draftId, row.id)).all().sort((a, b) => a.sortOrder - b.sortOrder);
    return { ...parseDraftContent({ ...row, readerUserIds: [], participantIds: JSON.parse(row.participantIdsJson), items: items.map(item => ({ ...item, ...(!item.assetId && !item.localCaptureRef ? { preservationState: "missing" } : {}) })) }), ...(row.inboxItemId && row.reviewedRevision !== row.revision && row.status === "editing" ? { reviewPending: true } : {}), id: row.id, inboxItemId: row.inboxItemId, authorPersonId: row.authorPersonId, authorName: row.authorName, status: row.status as DraftArchive["status"], memoryEventId: row.memoryEventId && eventIds.has(row.memoryEventId) ? row.memoryEventId : null, createdAt: row.createdAt, updatedAt: row.updatedAt };
  });
}
export function parseDraftArchive(value: unknown, refs: { assets: Set<string>; events: Set<string>; people: Set<string>; inbox: Set<string> }): DraftArchive[] {
  if (!Array.isArray(value)) throw new Error("invalid_drafts");
  const ids = new Set<string>(), itemIds = new Set<string>();
  return value.map(raw => {
    const content = parseDraftContent(raw);
    if (raw.reviewPending !== undefined && typeof raw.reviewPending !== "boolean") throw new Error("invalid_draft_review");
    const id = raw.id;
    if (typeof id !== "string" || !/^[\w-]{1,128}$/u.test(id) || ids.has(id)) throw new Error("invalid_draft_id");
    ids.add(id);
    if (raw.authorUserId !== undefined || raw.familyId !== undefined || !["editing", "published", "discarded"].includes(raw.status) || typeof raw.authorName !== "string" || raw.authorName.length > 200) throw new Error("invalid_draft_author");
    if (raw.inboxItemId !== null && !refs.inbox.has(raw.inboxItemId)) throw new Error("invalid_draft_inbox");
    if (raw.authorPersonId !== null && !refs.people.has(raw.authorPersonId)) throw new Error("invalid_draft_person");
    if (raw.memoryEventId !== null && (!refs.events.has(raw.memoryEventId) || raw.status !== "published")) throw new Error("invalid_draft_memory");
    if (typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string" || !Number.isFinite(Date.parse(raw.createdAt)) || !Number.isFinite(Date.parse(raw.updatedAt))) throw new Error("invalid_draft_time");
    if (content.participantIds.some(id => !refs.people.has(id))) throw new Error("invalid_draft_person");
    for (const item of content.items) {
      if (itemIds.has(item.id) || (item.assetId && !refs.assets.has(item.assetId))) throw new Error("invalid_draft_asset");
      itemIds.add(item.id);
    }
    return { ...content, ...(raw.reviewPending ? { reviewPending: true } : {}), id, inboxItemId: raw.inboxItemId, authorPersonId: raw.authorPersonId, authorName: raw.authorName, status: raw.status, memoryEventId: raw.memoryEventId, createdAt: raw.createdAt, updatedAt: raw.updatedAt };
  });
}
