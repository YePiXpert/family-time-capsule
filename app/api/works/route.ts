import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { isSameOrigin } from "@/lib/security/origin";
import { asRecord, mobileJson, mobileRequestError, readMobileJson } from "@/lib/mobile/http";
import { createWork } from "@/lib/books/projects/create-work";
import { BookError } from "@/lib/books/projects/service";
import { CollectionError } from "@/lib/collections/service";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "event:write");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const body = asRecord(await readMobileJson(request));
    if ("familyId" in body) throw new BookError("family_id_not_accepted");
    return mobileJson(createWork(auth.context, body), { status: 201 });
  } catch (error) {
    return error instanceof BookError || error instanceof CollectionError
      ? mobileJson({ error: error.code }, { status: error.status })
      : mobileRequestError(error);
  }
}
