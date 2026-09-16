import { anchorFromPrecisionInput, isOccurredAtPrecision } from "@/lib/metadata/precision";
import { zonedWallTimeToUtc } from "@/lib/metadata/time";
import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { isMilestoneType, updateMemoryEvent } from "@/lib/memories/service";
import { asRecord, mobileJson, mobileRequestError, optionalFamilyWallDate, optionalString, optionalStringArray, readMobileJson } from "@/lib/mobile/http";
import { getMobileMemory, MOBILE_MEMORY_READ_VERSION } from "@/lib/mobile/product";
import { isMemoryContentCurrent } from "@/lib/memories/read-access";
import { isEventVisibility } from "@/lib/authz/policy";
import { parseAppendItems } from "@/lib/memories/edit-staging";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  const memory = await getMobileMemory(authorization.context, (await params).id);
  return memory && isMemoryContentCurrent(authorization.context, memory.id, memory[MOBILE_MEMORY_READ_VERSION])
    ? mobileJson(memory) : mobileJson({ error: "not_found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "event:write");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  try {
    const body = asRecord(await readMobileJson(request, 512 * 1024));
    const rawWall = optionalString(body, "occurredAtWall", 19);
    const precision = optionalString(body, "occurredAtPrecision", 32);
    if (precision !== undefined && !isOccurredAtPrecision(precision)) return mobileJson({ error: "invalid_input" }, { status: 400 });
    const occurredAt = precision === "unknown" ? undefined : precision && rawWall
      ? anchorFromPrecisionInput({ precision, wall: rawWall, timezone: authorization.context.familyTimezone, toUtc: zonedWallTimeToUtc })
      : optionalFamilyWallDate(body, "occurredAtWall", authorization.context.familyTimezone);
    const milestoneType = optionalString(body, "milestoneType", 32);
    const isPinned = body.isPinned;
    if (
      occurredAt === null ||
      (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) ||
      (typeof body.mutationId !== "string" || !/^[\w-]{1,128}$/u.test(body.mutationId)) ||
      (milestoneType !== undefined && milestoneType !== null && !isMilestoneType(milestoneType)) ||
      (isPinned !== undefined && typeof isPinned !== "boolean")
      || (body.visibility !== undefined && !isEventVisibility(body.visibility))
      || (body.editDraftRevision !== undefined && (!Number.isSafeInteger(body.editDraftRevision) || Number(body.editDraftRevision) < 1))
    ) {
      return mobileJson({ error: "invalid_input" }, { status: 400 });
    }
    const result = await updateMemoryEvent(authorization.context.familyId, (await params).id, authorization.context.userId, {
      expectedTitleRevision: body.expectedRevision as number | undefined,
      mutationId: body.mutationId as string | undefined,
      bodyText: optionalString(body, "bodyText", 100_000) ?? undefined,
      coverAssetId: optionalString(body, "coverAssetId", 128),
      title: optionalString(body, "title", 100) ?? undefined,
      occurredAt: occurredAt ?? undefined,
      occurredAtPrecision: precision as "exact" | "approximate" | "date_only" | "month" | "year" | "unknown" | undefined,
      locationText: optionalString(body, "locationText", 200),
      participantPersonIds: optionalStringArray(body, "participantPersonIds"),
      childPersonId: optionalString(body, "childPersonId", 128),
      milestoneType,
      isPinned: isPinned as boolean | undefined,
      visibility: body.visibility as "family" | "members" | "private" | undefined,
      readerUserIds: optionalStringArray(body, "readerUserIds"),
      editDraftId: optionalString(body, "editDraftId", 128) ?? undefined,
      editDraftRevision: body.editDraftRevision as number | undefined,
      appendItems: body.appendItems === undefined ? undefined : parseAppendItems(body.appendItems),
    });
    if (!result.ok) return mobileJson({ error: result.error }, { status: result.error === "not_found" ? 404 : ["conflict", "edit_draft_conflict"].includes(result.error) ? 409 : ["source_reshare_forbidden", "asset_reshare_forbidden"].includes(result.error) ? 403 : 400 });
    const memory = await getMobileMemory(authorization.context, result.event.id);
    return memory && isMemoryContentCurrent(authorization.context, memory.id, memory[MOBILE_MEMORY_READ_VERSION])
      ? mobileJson({ ...memory, mutationReceipt: result.mutationReceipt }) : mobileJson({ error: "not_found" }, { status: 404 });
  } catch (error) {
    return mobileRequestError(error);
  }
}
