import { completePortalSubmission } from "@/lib/contribution-portals/service";
import { uploadJson, UUID_PATTERN } from "@/lib/imports/http";
import { anonymousRequestSubject } from "@/lib/security/anonymous-subject";
import { isSameOrigin } from "@/lib/security/origin";

type Context = { params: Promise<{ token: string; id: string }> };

export async function POST(request: Request, context: Context) {
  if (!isSameOrigin(request)) return uploadJson({ error: "forbidden" }, { status: 403 });
  const { token, id } = await context.params;
  if (!UUID_PATTERN.test(id)) return uploadJson({ error: "not_found" }, { status: 404 });
  const result = completePortalSubmission(token, id, anonymousRequestSubject(request.headers));
  if (!result.ok) {
    return uploadJson({ error: result.error }, {
      status: result.error === "upload_incomplete" ? 409 : result.error === "rate_limited" ? 429 : 404,
    });
  }
  return uploadJson({ success: true });
}
