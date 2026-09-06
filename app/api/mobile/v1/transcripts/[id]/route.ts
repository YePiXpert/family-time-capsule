import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { asset } from "@/db/schema/asset";
import { assetTranscript } from "@/db/schema/transcript";
import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { createContributionAccessSnapshot, getContributionAssetAccessInTransaction } from "@/lib/authz/contribution-access";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { asRecord, mobileJson, mobileRequestError, readMobileJson } from "@/lib/mobile/http";
import { isSameOrigin } from "@/lib/security/origin";
import { saveEditedTranscript } from "@/lib/transcripts/service";
import { parseReaderSegments } from "@/mobile/src/media/types";
import type { TranscriptReview } from "@/mobile/src/transcripts/types";

type RouteParams = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: RouteParams) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  return getDb().transaction(tx => {
    if (!getContributionAssetAccessInTransaction(tx, createContributionAccessSnapshot(auth.context), id).readable) return mobileJson({ error: "not_found" }, { status: 404 });
    const original = tx.select().from(asset).where(and(eq(asset.id, id), eq(asset.familyId, auth.context.familyId))).get();
    if (!original || original.originalAssetId !== null || !["audio", "video"].includes(original.type)) return mobileJson({ error: "not_found" }, { status: 404 });
    const row = tx.select().from(assetTranscript).where(and(eq(assetTranscript.assetId, id), eq(assetTranscript.familyId, auth.context.familyId))).get();
    const result: TranscriptReview = { assetId: id, canEdit: hasFamilyCapability(auth.context.role, "event:write"), transcript: row ? { text: row.editedTranscript ?? row.rawTranscript, edited: row.editedTranscript !== null, revision: row.revision, segments: row.editedTranscript === null ? parseReaderSegments(row.segmentsJson) : [] } : null };
    return mobileJson(result);
  });
}
export async function POST(request: Request, params: RouteParams) {
  if (!isSameOrigin(request)) return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "event:write");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const input = asRecord(await readMobileJson(request, 800_000));
    if (typeof input.text !== "string" || input.text.length > 200_000 || (input.revision !== null && (!Number.isSafeInteger(input.revision) || Number(input.revision) < 0))) return mobileJson({ error: "invalid_input" }, { status: 400 });
    const result = saveEditedTranscript(auth.context, (await params.params).id, input.text, { expectedRevision: input.revision === null ? null : Number(input.revision) });
    if (!result.ok) return mobileJson({ error: result.error }, { status: result.error === "forbidden" ? 403 : result.error === "not_found" ? 404 : result.error === "conflict" ? 409 : 400 });
    revalidatePath("/", "layout");
    return GET(request, params);
  } catch (error) { return mobileRequestError(error); }
}
