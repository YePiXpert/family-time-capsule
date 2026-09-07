import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { asset, documentText } from "@/db/schema/asset";
import { assetAnalysis } from "@/db/schema/analysis";
import { assetTranscript } from "@/db/schema/transcript";
import type { ContributionAccessTransaction as Tx } from "@/lib/authz/contribution-access";
export function assetNameEvidence(tx: Tx, familyId: string, id: string) {
  const original = tx.select().from(asset).where(and(eq(asset.id, id), eq(asset.familyId, familyId))).get();
  const analysis = tx.select().from(assetAnalysis).where(and(eq(assetAnalysis.assetId, id), eq(assetAnalysis.familyId, familyId))).get();
  const transcript = tx.select().from(assetTranscript).where(and(eq(assetTranscript.assetId, id), eq(assetTranscript.familyId, familyId))).get();
  const document = tx.select().from(documentText).where(and(eq(documentText.assetId, id), eq(documentText.familyId, familyId))).get();
  const fingerprint = createHash("sha256").update(JSON.stringify({ version: "asset-name-v1", sha: original?.sha256, metadataRevision: original?.metadataRevision, analysis, transcript, document })).digest("hex");
  return { original, analysis, transcript, document, fingerprint };
}
