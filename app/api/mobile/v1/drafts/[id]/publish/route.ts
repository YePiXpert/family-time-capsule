import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { publishDraft } from "@/lib/drafts/service";
import { draftResponseError } from "@/lib/drafts/http";
import { asRecord, mobileJson, readMobileJson } from "@/lib/mobile/http";
import { isSameOrigin } from "@/lib/security/origin";
export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "event:write");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const body = asRecord(await readMobileJson(request));
    return mobileJson(publishDraft(auth.context, (await route.params).id, body.expectedRevision as number));
  } catch (error) { return draftResponseError(error); }
}
