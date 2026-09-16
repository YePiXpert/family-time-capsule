import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { syncCollection } from "@/lib/collections/sync";
import { CollectionError } from "@/lib/collections/validation";
import {
  asRecord,
  mobileJson,
  readMobileJson,
  mobileRequestError,
} from "@/lib/mobile/http";
import { isSameOrigin } from "@/lib/security/origin";
export async function POST(request: Request) {
  if (!isSameOrigin(request))
    return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "event:write");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const body = asRecord(await readMobileJson(request));
    if (Object.hasOwn(body, "familyId"))
      throw new CollectionError("family_id_not_accepted");
    return mobileJson(syncCollection(auth.context, body));
  } catch (error) {
    return error instanceof CollectionError
      ? mobileJson({ error: error.code }, { status: error.status })
      : mobileRequestError(error);
  }
}
