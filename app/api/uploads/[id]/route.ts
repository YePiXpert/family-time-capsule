import { Readable } from "node:stream";
import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { UUID_PATTERN, uploadError, uploadJson } from "@/lib/imports/http";
import {
  appendUploadChunk,
  cancelUpload,
  getUploadSession,
  UploadServiceError,
} from "@/lib/imports/service";
import { isSameOrigin } from "@/lib/security/origin";

type Context = { params: Promise<{ id: string }> };

async function authorize(request: Request) {
  return authorizeApiFamilyRequest(request.headers, "capture:create");
}

export async function HEAD(request: Request, context: Context) {
  const authorization = await authorize(request);
  if (!authorization.ok) return new Response(null, { status: authorization.status });
  try {
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new UploadServiceError("not_found", 404);
    const session = await getUploadSession(authorization.context.familyId, id);
    return new Response(null, {
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "Upload-Offset": String(session.receivedBytes),
        "Upload-Length": String(session.totalBytes),
        "Upload-Expires": session.expiresAt.toISOString(),
        "Upload-Status": session.status,
      },
    });
  } catch (error) {
    const response = uploadError(error);
    return new Response(null, { status: response.status, headers: response.headers });
  }
}

export async function PATCH(request: Request, context: Context) {
  if (!isSameOrigin(request)) return uploadJson({ error: "forbidden" }, { status: 403 });
  const authorization = await authorize(request);
  if (!authorization.ok) {
    return uploadJson({ error: authorization.error }, { status: authorization.status });
  }
  try {
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new UploadServiceError("not_found", 404);
    if (request.headers.get("content-type") !== "application/offset+octet-stream") {
      throw new UploadServiceError("invalid_content_type", 415);
    }
    const offsetRaw = request.headers.get("upload-offset");
    const lengthRaw = request.headers.get("content-length");
    if (!offsetRaw || !/^\d+$/u.test(offsetRaw) || !lengthRaw || !/^\d+$/u.test(lengthRaw)) {
      throw new UploadServiceError("invalid_upload_headers", 400);
    }
    if (!request.body) throw new UploadServiceError("empty_chunk", 400);
    const result = await appendUploadChunk({
      familyId: authorization.context.familyId,
      uploadId: id,
      offset: Number(offsetRaw),
      contentLength: Number(lengthRaw),
      body: Readable.fromWeb(
        request.body as unknown as Parameters<typeof Readable.fromWeb>[0],
      ),
    });
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "private, no-store",
        "Upload-Offset": String(result.offset),
        "Upload-Replayed": String(result.replayed),
      },
    });
  } catch (error) {
    return uploadError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  if (!isSameOrigin(request)) return uploadJson({ error: "forbidden" }, { status: 403 });
  const authorization = await authorize(request);
  if (!authorization.ok) {
    return uploadJson({ error: authorization.error }, { status: authorization.status });
  }
  try {
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new UploadServiceError("not_found", 404);
    const session = await cancelUpload(authorization.context.familyId, id);
    return uploadJson({ uploadId: session.id, status: session.status });
  } catch (error) {
    return uploadError(error);
  }
}
