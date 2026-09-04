import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { mobileJson } from "@/lib/mobile/http";
import { getMobileSearch } from "@/lib/mobile/product";

export async function GET(request: Request) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
  const rawLimit = Number(url.searchParams.get("limit") ?? "25");
  const limit = Number.isSafeInteger(rawLimit) ? rawLimit : 25;
  return mobileJson(query ? getMobileSearch(authorization.context, query, url.searchParams.get("cursor"), limit) : { items: [], nextCursor: null });
}
