import { createPortalSubmission, type PortalFileDeclaration } from "@/lib/contribution-portals/service";
import { uploadJson, UUID_PATTERN } from "@/lib/imports/http";
import { anonymousRequestSubject } from "@/lib/security/anonymous-subject";
import { isSameOrigin, requestBodySizeError } from "@/lib/security/origin";

type Context = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: Context) {
  if (!isSameOrigin(request)) return uploadJson({ error: "forbidden" }, { status: 403 });
  const sizeError = requestBodySizeError(request, 256 * 1024);
  if (sizeError) return uploadJson({ error: sizeError }, { status: sizeError === "too_large" ? 413 : 411 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return uploadJson({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return uploadJson({ error: "invalid_input" }, { status: 400 });
  }
  const value = body as Record<string, unknown>;
  if (!Array.isArray(value.files) || value.files.length > 100) {
    return uploadJson({ error: "invalid_input" }, { status: 400 });
  }
  const files: PortalFileDeclaration[] = [];
  for (const raw of value.files) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return uploadJson({ error: "invalid_input" }, { status: 400 });
    }
    const file = raw as Record<string, unknown>;
    if (
      typeof file.captureId !== "string" || !UUID_PATTERN.test(file.captureId) ||
      typeof file.filename !== "string" || file.filename.length < 1 || file.filename.length > 200 ||
      typeof file.declaredMime !== "string" || file.declaredMime.length > 200 ||
      typeof file.totalBytes !== "number" || !Number.isSafeInteger(file.totalBytes) ||
      !(file.lastModified === null || (typeof file.lastModified === "number" && Number.isSafeInteger(file.lastModified) && file.lastModified > 0)) ||
      !(file.clientFingerprint === undefined || file.clientFingerprint === null ||
        (typeof file.clientFingerprint === "string" && /^[0-9a-f]{64}$/u.test(file.clientFingerprint)))
    ) {
      return uploadJson({ error: "invalid_input" }, { status: 400 });
    }
    files.push({
      captureId: file.captureId,
      filename: file.filename,
      declaredMime: file.declaredMime,
      totalBytes: file.totalBytes,
      lastModified: file.lastModified === null ? null : new Date(file.lastModified as number),
      clientFingerprint: typeof file.clientFingerprint === "string" ? file.clientFingerprint : null,
    });
  }
  const { token } = await context.params;
  const result = await createPortalSubmission(token, {
    guestDisplayName: typeof value.guestDisplayName === "string" ? value.guestDisplayName : null,
    text: typeof value.text === "string" ? value.text : null,
    files,
  }, anonymousRequestSubject(request.headers));
  if (!result.ok) {
    const status = result.error === "rate_limited" || result.error === "submission_limit" ? 429
      : result.error === "too_large" ? 413
        : result.error === "not_found" ? 404
          : 400;
    return uploadJson({ error: result.error }, { status });
  }
  return uploadJson(result, { status: 201 });
}
