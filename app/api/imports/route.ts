import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { getFamily } from "@/lib/family/service";
import { uploadError, uploadJson, UUID_PATTERN } from "@/lib/imports/http";
import { createImportSession, listImportSessions, UploadServiceError } from "@/lib/imports/service";
import { asRecord, optionalFamilyWallDate, optionalString, optionalStringArray, readMobileJson } from "@/lib/mobile/http";
import { isSameOrigin } from "@/lib/security/origin";

export async function GET(request: Request) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "capture:create");
  if (!authorization.ok) return uploadJson({ error: authorization.error }, { status: authorization.status });
  const url = new URL(request.url);
  const page = await listImportSessions(authorization.context.familyId, {
    cursor: url.searchParams.get("cursor"),
    limit: 50,
  });
  return uploadJson({
    sessions: page.sessions.map((session) => ({
      id: session.id,
      source: session.source,
      status: session.status,
      totalCount: session.totalCount,
      completedCount: session.completedCount,
      failedCount: session.failedCount,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    })),
    nextCursor: page.nextCursor,
  });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return uploadJson({ error: "forbidden" }, { status: 403 });
  const authorization = await authorizeApiFamilyRequest(request.headers, "capture:create");
  if (!authorization.ok) return uploadJson({ error: authorization.error }, { status: authorization.status });
  try {
    const body = asRecord(await readMobileJson(request));
    const source = body.source;
    if (!["web", "native", "share"].includes(String(source))) {
      throw new UploadServiceError("invalid_input", 400);
    }
    const title = optionalString(body, "defaultTitle", 200);
    const location = optionalString(body, "defaultLocationText", 200);
    const participantPersonIds = optionalStringArray(body, "participantPersonIds", 50) ?? [];
    if (participantPersonIds.some((id) => !UUID_PATTERN.test(id))) {
      throw new UploadServiceError("invalid_participants", 400);
    }
    const family = await getFamily(authorization.context.familyId);
    if (!family) throw new UploadServiceError("not_found", 404);
    const occurredAt = optionalFamilyWallDate(body, "defaultOccurredAt", family.timezone);
    const session = await createImportSession({
      familyId: authorization.context.familyId,
      createdByUserId: authorization.context.userId,
      source: source as "web" | "native" | "share",
      defaultTitle: title,
      defaultOccurredAt: occurredAt,
      defaultLocationText: location,
      participantPersonIds,
    });
    return uploadJson(
      { id: session.id, status: session.status },
      { status: 201, headers: { location: `/imports/${session.id}` } },
    );
  } catch (error) {
    return uploadError(error);
  }
}
