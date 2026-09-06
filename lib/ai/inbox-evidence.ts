import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { inboxItem, inboxItemAsset } from "@/db/schema/inbox";
import { asset } from "@/db/schema/asset";
import { assetAnalysis } from "@/db/schema/analysis";
import { assetTranscript } from "@/db/schema/transcript";
import type { ContributionAccessTransaction } from "@/lib/authz/contribution-access";

/** Normalized evidence only. Confirmation/naming do not change this snapshot;
 * a human transcript correction invalidates pending results based on old text. */
export function inboxEvidenceFingerprint(tx: ContributionAccessTransaction, familyId: string, id: string): string {
  const item = tx.select().from(inboxItem).where(and(eq(inboxItem.id, id), eq(inboxItem.familyId, familyId))).get();
  const sources = tx.select({ id: asset.id, sha: asset.sha256, capturedAt: asset.capturedAt, timeSource: asset.timeSource, analysis: assetAnalysis, transcript: assetTranscript }).from(inboxItemAsset).innerJoin(asset, eq(asset.id, inboxItemAsset.assetId)).leftJoin(assetAnalysis, eq(assetAnalysis.assetId, asset.id)).leftJoin(assetTranscript, eq(assetTranscript.assetId, asset.id)).where(and(eq(inboxItemAsset.inboxItemId, id), eq(asset.familyId, familyId))).orderBy(asc(asset.id)).all();
  return createHash("sha256").update(JSON.stringify({ version: "organizer-inbox-v2", rawText: item?.rawText, sources })).digest("hex");
}
