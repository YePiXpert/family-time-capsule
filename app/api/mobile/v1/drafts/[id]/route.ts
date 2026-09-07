import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { saveDraft, getDraft, discardDraft } from "@/lib/drafts/service";
import { draftResponseError } from "@/lib/drafts/http";
import { asRecord, mobileJson, readMobileJson } from "@/lib/mobile/http";
import { isSameOrigin } from "@/lib/security/origin";
type Route = { params: Promise<{ id: string }> };
export async function GET(request: Request, route: Route) {
  const auth = await authorizeApiFamilyRequest(request.headers, "capture:create");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  try { return mobileJson(getDraft(auth.context, (await route.params).id)); } catch (error) { return draftResponseError(error); }
}
export async function PUT(request: Request, route: Route) {
  if (!isSameOrigin(request)) return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "capture:create");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const body = asRecord(await readMobileJson(request, 1024 * 1024));
    return mobileJson(saveDraft(auth.context, (await route.params).id, body.expectedRevision as number, body.mutationId as string, body.content));
  } catch (error) { return draftResponseError(error); }
}
export async function DELETE(request: Request, route: Route) {
  if (!isSameOrigin(request)) return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "capture:create");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const body = asRecord(await readMobileJson(request));
    discardDraft(auth.context, (await route.params).id, body.expectedRevision as number);
    return mobileJson({ status: "discarded" });
  } catch (error) { return draftResponseError(error); }
}
