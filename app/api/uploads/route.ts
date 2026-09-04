import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { readMobileJson, asRecord } from "@/lib/mobile/http";
import { createUploadSession, UploadServiceError } from "@/lib/imports/service";
import { UUID_PATTERN, uploadError, uploadJson } from "@/lib/imports/http";
import { isSameOrigin } from "@/lib/security/origin";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return uploadJson({ error: "forbidden" }, { status: 403 });
  const authorization = await authorizeApiFamilyRequest(request.headers, "capture:create");
  if (!authorization.ok) {
    return uploadJson({ error: authorization.error }, { status: authorization.status });
  }
  try {
    const body = asRecord(await readMobileJson(request));
    const captureId = typeof body.captureId === "string" ? body.captureId : "";
    const filename = typeof body.filename === "string" ? body.filename.trim() : "";
    const declaredMime = typeof body.declaredMime === "string" ? body.declaredMime : "";
    const totalBytes = body.totalBytes;
    const source = body.source;
    const importSessionId = body.importSessionId;
    const lastModified = body.lastModified;
    if (
      !UUID_PATTERN.test(captureId) ||
      filename.length < 1 || filename.length > 200 ||
      typeof totalBytes !== "number" || !Number.isSafeInteger(totalBytes) ||
      !["web", "native", "share"].includes(String(source)) ||
      !(importSessionId === null || (typeof importSessionId === "string" && UUID_PATTERN.test(importSessionId))) ||
      !(lastModified === null || (typeof lastModified === "number" && Number.isSafeInteger(lastModified) && lastModified > 0))
    ) {
      throw new UploadServiceError("invalid_input", 400);
    }
    const result = await createUploadSession({
      familyId: authorization.context.familyId,
      userId: authorization.context.userId,
      captureId,
      filename,
      declaredMime,
      totalBytes,
      lastModified: lastModified === null ? null : new Date(lastModified as number),
      source: source as "web" | "native" | "share",
      importSessionId: importSessionId as string | null,
    });
    const { session } = result;
    return uploadJson(
      {
        uploadId: session.id,
        uploadOffset: session.receivedBytes,
        chunkSize: 8 * 1024 * 1024,
        expiresAt: session.expiresAt.toISOString(),
        status: session.status,
        assetId: session.finalAssetId,
        inboxItemId: session.finalInboxItemId,
      },
      {
        status: result.existing ? 200 : 201,
        headers: { location: `/api/uploads/${session.id}` },
      },
    );
  } catch (error) {
    return uploadError(error);
  }
}
