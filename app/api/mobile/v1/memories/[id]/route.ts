import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { isMilestoneType, updateMemoryEvent } from "@/lib/memories/service";
import { asRecord, mobileJson, mobileRequestError, optionalFamilyWallDate, optionalString, optionalStringArray, readMobileJson } from "@/lib/mobile/http";
import { getMobileMemory } from "@/lib/mobile/product";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  const memory = await getMobileMemory(authorization.context, (await params).id);
  return memory ? mobileJson(memory) : mobileJson({ error: "not_found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "event:write");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  try {
    const body = asRecord(await readMobileJson(request));
    const occurredAt = optionalFamilyWallDate(body, "occurredAtWall", authorization.context.familyTimezone);
    const precision = optionalString(body, "occurredAtPrecision", 32);
    const milestoneType = optionalString(body, "milestoneType", 32);
    const isPinned = body.isPinned;
    if (
      occurredAt === null ||
      (precision !== undefined && precision !== null && !["exact", "approximate", "date_only"].includes(precision)) ||
      (milestoneType !== undefined && milestoneType !== null && !isMilestoneType(milestoneType)) ||
      (isPinned !== undefined && typeof isPinned !== "boolean")
    ) {
      return mobileJson({ error: "invalid_input" }, { status: 400 });
    }
    const result = await updateMemoryEvent(authorization.context.familyId, (await params).id, authorization.context.userId, {
      title: optionalString(body, "title", 100) ?? undefined,
      occurredAt: occurredAt ?? undefined,
      occurredAtPrecision: precision as "exact" | "approximate" | "date_only" | undefined,
      locationText: optionalString(body, "locationText", 200),
      participantPersonIds: optionalStringArray(body, "participantPersonIds"),
      milestoneType,
      isPinned: isPinned as boolean | undefined,
    });
    if (!result.ok) return mobileJson({ error: result.error }, { status: result.error === "not_found" ? 404 : 400 });
    return mobileJson(await getMobileMemory(authorization.context, result.event.id));
  } catch (error) {
    return mobileRequestError(error);
  }
}
