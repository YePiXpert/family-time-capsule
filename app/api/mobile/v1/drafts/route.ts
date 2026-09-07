import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { listDrafts } from "@/lib/drafts/service";
import { draftResponseError } from "@/lib/drafts/http";
import { mobileJson } from "@/lib/mobile/http";
export async function GET(request: Request) {
  const auth = await authorizeApiFamilyRequest(request.headers, "capture:create");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  try { return mobileJson({ drafts: listDrafts(auth.context) }); } catch (error) { return draftResponseError(error); }
}
