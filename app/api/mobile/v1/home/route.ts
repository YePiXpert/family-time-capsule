import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { mobileJson } from "@/lib/mobile/http";
import { getMobileHome } from "@/lib/mobile/product";

export async function GET(request: Request) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  return mobileJson(await getMobileHome(authorization.context));
}
