import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { getInboxEntry } from "@/lib/inbox/service";
import { defaultTitle, mergeInboxEntries } from "@/lib/memories/service";
import { asRecord, mobileJson, mobileRequestError, optionalDate, optionalString, optionalStringArray, readMobileJson } from "@/lib/mobile/http";

export async function POST(request: Request) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "inbox:review");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  try {
    const body = asRecord(await readMobileJson(request));
    const itemIds = optionalStringArray(body, "itemIds", 50) ?? [];
    if (itemIds.length < 2) return mobileJson({ error: "invalid_input" }, { status: 400 });
    const entries = await Promise.all(itemIds.map((itemId) => getInboxEntry(authorization.context.familyId, itemId)));
    if (entries.some((entry) => !entry)) return mobileJson({ error: "not_found" }, { status: 404 });
    const first = entries[0]!;
    const title = optionalString(body, "title", 100)?.trim() || first.item.draftTitle || defaultTitle(first);
    const participants = optionalStringArray(body, "participantPersonIds") ?? [...new Set(entries.flatMap((entry) => entry?.participantPersonIds ?? []))];
    const result = await mergeInboxEntries(authorization.context.familyId, itemIds, {
      title,
      occurredAt: optionalDate(body, "occurredAt") ?? undefined,
      locationText: optionalString(body, "locationText", 200) ?? first.item.draftLocationText,
      participantPersonIds: participants,
    });
    if (!result.ok) return mobileJson({ error: result.error }, { status: result.error === "not_found" ? 404 : 400 });
    return mobileJson({ status: "confirmed", memoryEventId: result.eventId }, { status: 201 });
  } catch (error) {
    return mobileRequestError(error);
  }
}
