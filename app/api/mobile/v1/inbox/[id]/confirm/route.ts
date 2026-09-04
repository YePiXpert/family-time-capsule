import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { getInboxEntry } from "@/lib/inbox/service";
import { confirmInboxEntry } from "@/lib/memories/service";
import { asRecord, mobileJson, mobileRequestError, optionalFamilyWallDate, optionalString, optionalStringArray, readMobileJson } from "@/lib/mobile/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "inbox:review");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  try {
    const body = asRecord(await readMobileJson(request));
    const entry = await getInboxEntry(authorization.context.familyId, (await params).id);
    if (!entry) return mobileJson({ error: "not_found" }, { status: 404 });
    const result = await confirmInboxEntry(authorization.context.familyId, entry, {
      title: optionalString(body, "title", 100) ?? undefined,
      occurredAt: optionalFamilyWallDate(body, "occurredAtWall", authorization.context.familyTimezone) ?? undefined,
      locationText: optionalString(body, "locationText", 200),
      participantPersonIds: optionalStringArray(body, "participantPersonIds"),
    });
    if (!result.ok) return mobileJson({ error: result.error }, { status: result.error === "not_found" ? 404 : 400 });
    return mobileJson({ status: "confirmed", memoryEventId: result.eventId }, { status: 201 });
  } catch (error) {
    return mobileRequestError(error);
  }
}
