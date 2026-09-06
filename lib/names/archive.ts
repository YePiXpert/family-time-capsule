import "server-only";
import { and, eq, gt, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { aiSuggestion } from "@/db/schema/suggestion";
import { NAME_SOURCES, nameSource } from "@/lib/naming";

export type ArchivedNameReview = {
  id: string; entityType: "memory_event" | "inbox_item"; entityId: string;
  title: string; provider: string; model: string; sourceFingerprint: string;
  status: "accepted" | "rejected"; revision: number; targetRevision: number | null;
  appliedRevision: number | null; previousName: { text: string | null; source: string } | null;
  createdAt: string; resolvedAt: string; undoneAt: string | null; resolvedByUserId: string | null;
};

/** Adopted edits and deliberate rejection/undo tombstones are family data.
 * Pending results, provider secrets, consent and job state are not portable. */
export function collectNameReviews(familyId: string, events: Set<string>, inbox: Set<string>): ArchivedNameReview[] {
  return getDb().select().from(aiSuggestion).where(and(eq(aiSuggestion.familyId, familyId), eq(aiSuggestion.suggestionType, "title"), ne(aiSuggestion.status, "pending"), gt(aiSuggestion.revision, 0))).all()
    .filter(row => (row.entityType === "memory_event" ? events : row.entityType === "inbox_item" ? inbox : new Set()).has(row.entityId))
    .map(row => ({ id: row.id, entityType: row.entityType as ArchivedNameReview["entityType"], entityId: row.entityId,
      title: JSON.parse(row.valueJson).title, provider: row.provider, model: row.model, sourceFingerprint: row.sourceFingerprint,
      status: row.status as ArchivedNameReview["status"], revision: row.revision, targetRevision: row.targetRevision,
      appliedRevision: row.appliedRevision, previousName: row.previousNameJson ? JSON.parse(row.previousNameJson) : null,
      createdAt: row.createdAt.toISOString(), resolvedAt: row.resolvedAt!.toISOString(), undoneAt: row.undoneAt?.toISOString() ?? null, resolvedByUserId: row.resolvedByUserId,
    }));
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const id = (value: unknown): value is string => text(value, 256) && /^[A-Za-z0-9_.:@-]+$/u.test(value);
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value));
function check(value: unknown): asserts value { if (!value) throw new Error("invalid name review archive"); }

export function parseNameReviews(value: unknown, events: Map<string, number>, inbox: Map<string, number>): ArchivedNameReview[] {
  check(Array.isArray(value));
  const ids = new Set<string>();
  return value.map(row => {
    check(record(row) && id(row.id) && !ids.has(row.id)); ids.add(row.id);
    check((row.entityType === "memory_event" || row.entityType === "inbox_item") && id(row.entityId));
    const targetRevision = (row.entityType === "memory_event" ? events : inbox).get(row.entityId);
    check(targetRevision !== undefined);
    check(text(row.title, 100) && text(row.provider, 100) && text(row.model, 256));
    check(typeof row.sourceFingerprint === "string" && /^[0-9a-f]{64}$/u.test(row.sourceFingerprint));
    check((row.status === "accepted" || row.status === "rejected") && revision(row.revision) && row.revision >= 1);
    check(row.targetRevision === null || (revision(row.targetRevision) && row.targetRevision <= targetRevision));
    check(date(row.createdAt) && date(row.resolvedAt) && Date.parse(row.resolvedAt) >= Date.parse(row.createdAt));
    check(row.resolvedByUserId === null || id(row.resolvedByUserId));
    check(row.undoneAt === null || (date(row.undoneAt) && row.undoneAt === row.resolvedAt && row.status === "rejected"));
    if (row.status === "accepted" || row.undoneAt !== null) {
      check(revision(row.targetRevision) && revision(row.appliedRevision) && row.appliedRevision === row.targetRevision + 1 && row.appliedRevision <= targetRevision);
      check(record(row.previousName) && (row.previousName.text === null || text(row.previousName.text, 100)) && NAME_SOURCES.includes(row.previousName.source as typeof NAME_SOURCES[number]));
      check(row.entityType !== "memory_event" || row.previousName.text !== null);
      check(row.undoneAt === null || (row.revision >= 2 && row.appliedRevision < targetRevision));
    } else check(row.appliedRevision === null && row.previousName === null);
    // Explicit projection: unknown archive keys can never become operational state.
    return { id: row.id, entityType: row.entityType, entityId: row.entityId, title: row.title, provider: row.provider, model: row.model, sourceFingerprint: row.sourceFingerprint,
      status: row.status, revision: row.revision, targetRevision: row.targetRevision as number | null, appliedRevision: row.appliedRevision as number | null,
      previousName: row.previousName === null ? null : { text: (row.previousName as { text: string | null }).text, source: nameSource((row.previousName as { source: string }).source) },
      createdAt: row.createdAt, resolvedAt: row.resolvedAt, undoneAt: row.undoneAt as string | null, resolvedByUserId: row.resolvedByUserId as string | null };
  });
}
