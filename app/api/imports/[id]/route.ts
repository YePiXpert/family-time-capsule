import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { uploadError, uploadJson, UUID_PATTERN } from "@/lib/imports/http";
import {
  cancelImportSession,
  getImportSessionDetail,
  setImportSessionUploading,
  UploadServiceError,
} from "@/lib/imports/service";
import { asRecord, readMobileJson } from "@/lib/mobile/http";
import { isSameOrigin } from "@/lib/security/origin";

type Context = { params: Promise<{ id: string }> };

function dto(detail: NonNullable<Awaited<ReturnType<typeof getImportSessionDetail>>>) {
  return {
    session: {
      id: detail.session.id,
      source: detail.session.source,
      status: detail.session.status,
      totalCount: detail.session.totalCount,
      completedCount: detail.session.completedCount,
      failedCount: detail.session.failedCount,
      defaultTitle: detail.session.defaultTitle,
      defaultOccurredAt: detail.session.defaultOccurredAt?.toISOString() ?? null,
      defaultLocationText: detail.session.defaultLocationText,
      participantPersonIds: detail.participantPersonIds,
      createdAt: detail.session.createdAt.toISOString(),
      updatedAt: detail.session.updatedAt.toISOString(),
    },
    items: detail.items.map(({ item, upload }) => ({
      id: item.id,
      captureId: item.captureId,
      status: item.status,
      errorCode: item.errorCode,
      sortOrder: item.sortOrder,
      assetId: item.assetId,
      inboxItemId: item.inboxItemId,
      upload: upload ? {
        id: upload.id,
        filename: upload.filename,
        declaredMime: upload.declaredMime,
        totalBytes: upload.totalBytes,
        receivedBytes: upload.receivedBytes,
        lastModified: upload.lastModified?.getTime() ?? null,
        clientFingerprint: upload.clientFingerprint,
        status: upload.status,
        expiresAt: upload.expiresAt.toISOString(),
      } : null,
    })),
  };
}

export async function GET(request: Request, context: Context) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "capture:create");
  if (!authorization.ok) return uploadJson({ error: authorization.error }, { status: authorization.status });
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return uploadJson({ error: "not_found" }, { status: 404 });
  const detail = await getImportSessionDetail(authorization.context.familyId, id);
  return detail ? uploadJson(dto(detail)) : uploadJson({ error: "not_found" }, { status: 404 });
}

export async function PATCH(request: Request, context: Context) {
  if (!isSameOrigin(request)) return uploadJson({ error: "forbidden" }, { status: 403 });
  const authorization = await authorizeApiFamilyRequest(request.headers, "capture:create");
  if (!authorization.ok) return uploadJson({ error: authorization.error }, { status: authorization.status });
  try {
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new UploadServiceError("not_found", 404);
    const body = asRecord(await readMobileJson(request));
    const action = body.action;
    const session = action === "cancel"
      ? await cancelImportSession(authorization.context.familyId, id)
      : action === "pause" || action === "resume"
        ? await setImportSessionUploading(authorization.context.familyId, id, action === "resume")
        : null;
    if (!session) throw new UploadServiceError("invalid_action", 400);
    return uploadJson({ id: session.id, status: session.status });
  } catch (error) {
    return uploadError(error);
  }
}
