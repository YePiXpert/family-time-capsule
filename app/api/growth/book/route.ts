import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { asRecord, mobileJson, mobileRequestError, readMobileJson } from "@/lib/mobile/http";
import { isSameOrigin } from "@/lib/security/origin";
import { openGrowthBook } from "@/lib/growth/service";
import { BookError } from "@/lib/books/projects/service";
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "event:write");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const body = asRecord(await readMobileJson(request));
    if (Object.keys(body).some(k => k !== "month")) throw new BookError("invalid_input");
    const book = openGrowthBook(auth.context, body.month === undefined ? 1 : body.month as number);
    return mobileJson({ id: book.id });
  } catch (error) { return error instanceof BookError ? mobileJson({ error: error.code }, { status: error.status }) : mobileRequestError(error); }
}
