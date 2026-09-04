import { authorizePortalUpload } from "@/lib/contribution-portals/service";
import { restartUpload } from "@/lib/imports/service";
import { uploadError, uploadJson, UUID_PATTERN } from "@/lib/imports/http";
import { anonymousRequestSubject } from "@/lib/security/anonymous-subject";
import { isSameOrigin } from "@/lib/security/origin";

type Context = { params: Promise<{ token: string; id: string }> };

export async function POST(request: Request, context: Context) {
  if (!isSameOrigin(request)) return uploadJson({ error: "forbidden" }, { status: 403 });
  const { token, id } = await context.params;
  if (!UUID_PATTERN.test(id)) return uploadJson({ error: "not_found" }, { status: 404 });
  const authorization = authorizePortalUpload(token, id, anonymousRequestSubject(request.headers));
  if (!authorization.ok) return uploadJson({ error: "not_found" }, { status: 404 });
  try {
    const session = await restartUpload(authorization.familyId, id);
    return uploadJson({ uploadId: id, uploadOffset: session.receivedBytes, status: session.status });
  } catch (error) {
    return uploadError(error);
  }
}
