import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { asset } from "@/db/schema/asset";
import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { createContributionAccessSnapshot, getContributionAssetAccessInTransaction } from "@/lib/authz/contribution-access";
import { mobileJson } from "@/lib/mobile/http";
import { readableName } from "@/lib/naming";

/** The same live permission as original bytes also protects preview metadata. */
export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  const { assetId } = await params;
  const original = getDb().transaction(tx => {
    if (!getContributionAssetAccessInTransaction(tx, createContributionAccessSnapshot(auth.context), assetId).readable) return null;
    return tx.select().from(asset).where(and(eq(asset.id, assetId), eq(asset.familyId, auth.context.familyId), isNull(asset.originalAssetId))).get();
  });
  if (!original) return mobileJson({ error: "not_found" }, { status: 404 });
  const name = readableName({ title: original.displayName, source: original.nameSource, mediaType: original.type, originalFilename: original.originalFilename, capturedAt: original.capturedAt, timeSource: original.timeSource, durationMs: original.durationMs, timezone: auth.context.familyTimezone }).text;
  return mobileJson({ id: original.id, type: original.type, filename: name, mimeType: original.mimeType, durationMs: original.durationMs });
}
