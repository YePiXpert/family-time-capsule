import {
  createPortalSubmissionUpload,
  type PortalFileDeclaration,
} from "@/lib/contribution-portals/service";
import { uploadJson, UUID_PATTERN } from "@/lib/imports/http";
import { anonymousRequestSubject } from "@/lib/security/anonymous-subject";
import { isSameOrigin, requestBodySizeError } from "@/lib/security/origin";

type Context = { params: Promise<{ token: string; id: string }> };

export async function POST(request: Request, context: Context) {
  if (!isSameOrigin(request)) return uploadJson({ error: "forbidden" }, { status: 403 });
  const sizeError = requestBodySizeError(request, 16 * 1024);
  if (sizeError) return uploadJson({ error: sizeError }, { status: sizeError === "too_large" ? 413 : 411 });
  let value: Record<string, unknown>;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
    value = body as Record<string, unknown>;
  } catch {
    return uploadJson({ error: "invalid_json" }, { status: 400 });
  }
  const { token, id } = await context.params;
  if (
    !UUID_PATTERN.test(id) ||
    typeof value.captureId !== "string" || !UUID_PATTERN.test(value.captureId) ||
    typeof value.filename !== "string" || value.filename.length < 1 || value.filename.length > 200 ||
    typeof value.declaredMime !== "string" || value.declaredMime.length > 200 ||
    typeof value.totalBytes !== "number" || !Number.isSafeInteger(value.totalBytes) ||
    !(value.lastModified === null || (typeof value.lastModified === "number" && Number.isSafeInteger(value.lastModified) && value.lastModified > 0)) ||
    !(value.clientFingerprint === undefined || value.clientFingerprint === null ||
      (typeof value.clientFingerprint === "string" && /^[0-9a-f]{64}$/u.test(value.clientFingerprint)))
  ) {
    return uploadJson({ error: "invalid_input" }, { status: 400 });
  }
  const file: PortalFileDeclaration = {
    captureId: value.captureId,
    filename: value.filename,
    declaredMime: value.declaredMime,
    totalBytes: value.totalBytes,
    lastModified: value.lastModified === null ? null : new Date(value.lastModified as number),
    clientFingerprint: typeof value.clientFingerprint === "string" ? value.clientFingerprint : null,
  };
  const result = await createPortalSubmissionUpload(
    token,
    id,
    file,
    anonymousRequestSubject(request.headers),
  );
  if (!result.ok) {
    const status = result.error === "rate_limited" ? 429
      : result.error === "too_large" ? 413
        : result.error === "not_found" ? 404
          : result.error.includes("quota") || result.error === "too_many_active_uploads" ? 429
            : 400;
    return uploadJson({ error: result.error }, { status });
  }
  return uploadJson(result, { status: 201 });
}
