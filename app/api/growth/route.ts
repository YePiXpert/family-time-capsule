import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { mobileJson, mobileRequestError } from "@/lib/mobile/http";
import { getGrowthOverview } from "@/lib/growth/service";
import { BookError } from "@/lib/books/projects/service";
export async function GET(request: Request) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  try { return mobileJson(getGrowthOverview(auth.context, Number(new URL(request.url).searchParams.get("month") ?? "1"))); }
  catch (error) { return error instanceof BookError ? mobileJson({ error: error.code }, { status: error.status }) : mobileRequestError(error); }
}
