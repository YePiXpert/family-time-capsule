import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { importSession, importSessionItem } from "@/db/schema/import";
import { inboxItem } from "@/db/schema/inbox";
import { user } from "@/db/schema/auth";
import { hasFamilyCapability } from "@/lib/authz/policy";
import type { FamilyContext } from "@/lib/family/context";
import { DraftError, getDraft, saveDraft } from "@/lib/drafts/service";
import { emptyDraftContent } from "@/lib/drafts/model";

/** Author-owned intake destination, separate from transfer and memory status. */
export function chooseIntake(context: FamilyContext, id: string, input: { destination: "draft" | "library"; revision: number; draftId?: string; draftRevision?: number; mutationId: string; recordOnly?: boolean }) {
  if (!["draft", "library"].includes(input.destination) || !Number.isSafeInteger(input.revision) || input.revision < 0) throw new DraftError("invalid_intake");
  return getDb().transaction(tx => {
    const actor = tx.select().from(user).where(and(eq(user.id, context.userId), eq(user.familyId, context.familyId), isNull(user.disabledAt))).get();
    if (!actor || actor.role !== context.role || !hasFamilyCapability(context.role, "capture:create")) throw new DraftError("forbidden", 403);
    const row = tx.select().from(importSession).where(and(eq(importSession.id, id), eq(importSession.familyId, context.familyId), eq(importSession.createdByUserId, context.userId))).get();
    if (!row || row.source === "guest") throw new DraftError("not_found", 404);
    if (row.intakeDestination !== "pending") return { destination: row.intakeDestination, draftId: row.intakeDraftId, revision: row.intakeRevision };
    if (row.intakeRevision !== input.revision) throw new DraftError("revision_conflict", 409);
    const rows = tx.select().from(importSessionItem).where(eq(importSessionItem.importSessionId, row.id)).orderBy(asc(importSessionItem.sortOrder)).all();
    // Choosing while uploads are arriving could silently omit later originals.
    if (!input.recordOnly && rows.some(item => ["pending", "uploading"].includes(item.status))) throw new DraftError("intake_pending", 409);
    const complete = rows.filter(item => item.status === "completed");
    if (!input.recordOnly && !complete.length) throw new DraftError("empty_intake");
    let draftId: string | null = null;
    if (input.destination === "draft") {
      draftId = input.draftId ?? randomUUID();
      if (input.recordOnly) {
        if (!["native", "share"].includes(row.source)) throw new DraftError("invalid_intake");
        // The native aggregate has already arrived/published. Link its receipt;
        // do not append the same text or resurrect removed item references.
        getDraft(context, draftId);
      } else {
      const existing = (input.draftRevision ?? 0) > 0 ? getDraft(context, draftId) : null;
      const content = existing ?? emptyDraftContent();
      const items = [...content.items];
      const text = [content.text];
      for (const item of complete) {
        if (item.assetId && !items.some(ref => ref.assetId === item.assetId)) items.push({ id: randomUUID(), assetId: item.assetId, localCaptureRef: null, caption: "" });
        if (!item.assetId && item.inboxItemId) {
          const source = tx.select().from(inboxItem).where(and(eq(inboxItem.id, item.inboxItemId), eq(inboxItem.familyId, context.familyId))).get();
          if (source?.rawText) text.push(source.rawText);
        }
      }
      const combined = text.filter(Boolean).join("\n\n");
      if (items.length > 200 || combined.length > 5000) throw new DraftError("intake_too_large", 413);
      saveDraft(context, draftId, input.draftRevision ?? 0, input.mutationId, { ...content, text: combined, items, coverItemId: content.coverItemId ?? items[0]?.id ?? null });
      }
    }
    tx.update(importSession).set({ intakeDestination: input.destination, intakeDraftId: draftId, intakeRevision: row.intakeRevision + 1, updatedAt: new Date() }).where(eq(importSession.id, id)).run();
    return { destination: input.destination, draftId, revision: row.intakeRevision + 1 };
  }, { behavior: "immediate" });
}
