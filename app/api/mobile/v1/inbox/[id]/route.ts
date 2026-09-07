import { getDb } from "@/db";
import { createContributionAccessSnapshot, getContributionAssetAccessInTransaction } from "@/lib/authz/contribution-access";
import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { updateInboxDraft } from "@/lib/inbox/service";
import { asRecord, mobileJson, mobileRequestError, optionalFamilyWallDate, optionalString, optionalStringArray, readMobileJson } from "@/lib/mobile/http";
import { getMobileInboxEntry } from "@/lib/mobile/product";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "inbox:review");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  try {
    const body = asRecord(await readMobileJson(request));
    const occurredAt = optionalFamilyWallDate(body, "occurredAtWall", authorization.context.familyTimezone);
    const entry = await updateInboxDraft(authorization.context.familyId, (await params).id, {
      title: optionalString(body, "title", 100),
      occurredAt,
      locationText: optionalString(body, "locationText", 200),
      participantPersonIds: optionalStringArray(body, "participantPersonIds"),
    });
    if (!entry) return mobileJson({ error: "not_found_or_invalid" }, { status: 404 });
    return mobileJson({
      entry: await getMobileInboxEntry(authorization.context, entry),
    });
  } catch (error) {
    return mobileRequestError(error);
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "capture:create");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  const { getInboxEntry } = await import("@/lib/inbox/service");
  const entry = await getInboxEntry(authorization.context.familyId, (await params).id);
  if (!entry || !getDb().transaction(tx => entry.assets.every(asset => getContributionAssetAccessInTransaction(tx, createContributionAccessSnapshot(authorization.context), asset.id).readable))) return mobileJson({ error: "not_found" }, { status: 404 });
  return mobileJson(await getMobileInboxEntry(authorization.context, entry));
}
