import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { UUID_PATTERN, uploadError, uploadJson } from "@/lib/imports/http";
import { completeUpload, UploadServiceError } from "@/lib/imports/service";
import { isSameOrigin } from "@/lib/security/origin";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  if (!isSameOrigin(request)) return uploadJson({ error: "forbidden" }, { status: 403 });
  const authorization = await authorizeApiFamilyRequest(request.headers, "capture:create");
  if (!authorization.ok) {
    return uploadJson({ error: authorization.error }, { status: authorization.status });
  }
  try {
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new UploadServiceError("not_found", 404);
    const result = await completeUpload(authorization.context.familyId, id);
    return uploadJson(result, { status: result.status === "stored" ? 201 : 200 });
  } catch (error) {
    return uploadError(error);
  }
}
