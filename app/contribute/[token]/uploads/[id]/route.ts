import { Readable } from "node:stream";
import { authorizePortalUpload } from "@/lib/contribution-portals/service";
import { appendUploadChunk, cancelUpload, getUploadSession, UploadServiceError } from "@/lib/imports/service";
import { uploadError, uploadJson, UUID_PATTERN } from "@/lib/imports/http";
import { anonymousRequestSubject } from "@/lib/security/anonymous-subject";
import { isSameOrigin } from "@/lib/security/origin";

type Context = { params: Promise<{ token: string; id: string }> };

async function authorize(request: Request, context: Context) {
  const { token, id } = await context.params;
  if (!UUID_PATTERN.test(id)) return { ok: false as const, error: "not_found" };
  return authorizePortalUpload(token, id, anonymousRequestSubject(request.headers));
}

export async function HEAD(request: Request, context: Context) {
  const authorization = await authorize(request, context);
  if (!authorization.ok) return new Response(null, { status: authorization.error === "rate_limited" ? 429 : 404 });
  try {
    const session = await getUploadSession(authorization.familyId, authorization.session.id);
    return new Response(null, { status: 200, headers: {
      "cache-control": "private, no-store",
      "Upload-Offset": String(session.receivedBytes),
      "Upload-Length": String(session.totalBytes),
      "Upload-Expires": session.expiresAt.toISOString(),
      "Upload-Status": session.status,
    } });
  } catch (error) {
    const response = uploadError(error);
    return new Response(null, { status: response.status, headers: response.headers });
  }
}

export async function PATCH(request: Request, context: Context) {
  if (!isSameOrigin(request)) return uploadJson({ error: "forbidden" }, { status: 403 });
  const authorization = await authorize(request, context);
  if (!authorization.ok) return uploadJson({ error: "not_found" }, { status: 404 });
  try {
    if (request.headers.get("content-type") !== "application/offset+octet-stream") {
      throw new UploadServiceError("invalid_content_type", 415);
    }
    const offsetRaw = request.headers.get("upload-offset");
    const lengthRaw = request.headers.get("content-length");
    if (!offsetRaw || !/^\d+$/u.test(offsetRaw) || !lengthRaw || !/^\d+$/u.test(lengthRaw) || !request.body) {
      throw new UploadServiceError("invalid_upload_headers", 400);
    }
    const result = await appendUploadChunk({
      familyId: authorization.familyId,
      uploadId: authorization.session.id,
      offset: Number(offsetRaw),
      contentLength: Number(lengthRaw),
      body: Readable.fromWeb(request.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
    });
    return new Response(null, { status: 204, headers: {
      "cache-control": "private, no-store",
      "Upload-Offset": String(result.offset),
      "Upload-Replayed": String(result.replayed),
    } });
  } catch (error) {
    return uploadError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  if (!isSameOrigin(request)) return uploadJson({ error: "forbidden" }, { status: 403 });
  const authorization = await authorize(request, context);
  if (!authorization.ok) return uploadJson({ error: "not_found" }, { status: 404 });
  try {
    const session = await cancelUpload(authorization.familyId, authorization.session.id);
    return uploadJson({ uploadId: session.id, status: session.status });
  } catch (error) {
    return uploadError(error);
  }
}
