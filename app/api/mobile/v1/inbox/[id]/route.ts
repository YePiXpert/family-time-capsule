import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { updateInboxDraft } from "@/lib/inbox/service";
import { asRecord, mobileJson, mobileRequestError, optionalDate, optionalString, optionalStringArray, readMobileJson } from "@/lib/mobile/http";
import { getMobileInboxEntry } from "@/lib/mobile/product";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "inbox:review");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  try {
    const body = asRecord(await readMobileJson(request));
    const occurredAt = optionalDate(body, "occurredAt");
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
