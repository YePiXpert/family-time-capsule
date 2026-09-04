import { UploadServiceError } from "./service";
import { MobileRequestError } from "@/lib/mobile/http";

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function uploadJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store");
  return Response.json(body, { ...init, headers });
}

export function uploadError(error: unknown): Response {
  if (error instanceof MobileRequestError) {
    return uploadJson({ error: error.code }, { status: error.status });
  }
  if (!(error instanceof UploadServiceError)) {
    return uploadJson({ error: "internal_error" }, { status: 500 });
  }
  const headers = new Headers();
  if (error.uploadOffset !== undefined) {
    headers.set("Upload-Offset", String(error.uploadOffset));
  }
  return uploadJson({ error: error.code, uploadOffset: error.uploadOffset }, {
    status: error.status,
    headers,
  });
}
