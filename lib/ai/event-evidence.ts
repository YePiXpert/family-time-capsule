import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { aiJobSource } from "@/db/schema/ai-job";
import { assetAnalysis } from "@/db/schema/analysis";
import { assetTranscript } from "@/db/schema/transcript";
import { contribution, fact } from "@/db/schema/contribution";
import { inboxItem } from "@/db/schema/inbox";
import { memoryEventTag } from "@/db/schema/suggestion";
import type { ContributionAccessTransaction } from "@/lib/authz/contribution-access";

/** Exact normalized evidence consumed by the event handler, excluding the
 * newly generated suggestions/facts themselves. Never exported or logged. */
export function eventEvidenceFingerprint(tx: ContributionAccessTransaction, familyId: string, eventId: string, jobId: string): string {
  const refs = tx.select().from(aiJobSource).where(eq(aiJobSource.jobId, jobId)).orderBy(asc(aiJobSource.sourceKind), asc(aiJobSource.sourceId)).all();
  const sources = refs.map(ref => {
    if (ref.sourceKind === "asset") return { ref, analysis: tx.select().from(assetAnalysis).where(and(eq(assetAnalysis.assetId, ref.sourceId), eq(assetAnalysis.familyId, familyId))).get(), transcript: tx.select().from(assetTranscript).where(and(eq(assetTranscript.assetId, ref.sourceId), eq(assetTranscript.familyId, familyId))).get() };
    if (ref.sourceKind === "contribution") return { ref, contribution: tx.select().from(contribution).where(eq(contribution.id, ref.sourceId)).get() };
    if (ref.sourceKind === "inbox_item") return { ref, rawText: tx.select({ rawText: inboxItem.rawText }).from(inboxItem).where(and(eq(inboxItem.id, ref.sourceId), eq(inboxItem.familyId, familyId))).get()?.rawText };
    return { ref };
  });
  const facts = tx.select({ id: fact.id, statement: fact.statement }).from(fact).where(and(eq(fact.memoryEventId, eventId), eq(fact.status, "user_confirmed"))).orderBy(asc(fact.id)).all();
  const tags = tx.select({ tag: memoryEventTag.tag }).from(memoryEventTag).where(and(eq(memoryEventTag.familyId, familyId), eq(memoryEventTag.memoryEventId, eventId))).orderBy(asc(memoryEventTag.tag)).all();
  return createHash("sha256").update(JSON.stringify({ promptVersion: "organizer-event-v2", sources, facts, tags })).digest("hex");
}
