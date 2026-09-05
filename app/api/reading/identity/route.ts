import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { getReadingIdentity } from "@/lib/reading/service";
import { mobileJson } from "@/lib/mobile/http";
export async function GET(request: Request) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  return auth.ok
    ? mobileJson(getReadingIdentity(auth.context))
    : mobileJson({ error: auth.error }, { status: auth.status });
}
