import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { mobileJson } from "@/lib/mobile/http";
import { getMobileInbox } from "@/lib/mobile/product";

export async function GET(request: Request) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "25");
  const limit = Number.isSafeInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 25;
  return mobileJson(await getMobileInbox(authorization.context, url.searchParams.get("cursor"), limit));
}
