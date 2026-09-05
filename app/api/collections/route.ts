import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import {
  listCollections,
  createCollection,
  CollectionError,
} from "@/lib/collections/service";
import {
  asRecord,
  mobileJson,
  readMobileJson,
  mobileRequestError,
} from "@/lib/mobile/http";
import { isSameOrigin } from "@/lib/security/origin";
export async function GET(request: Request) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const query = new URL(request.url).searchParams;
    return mobileJson(
      listCollections(auth.context, {
        deleted: query.get("deleted") === "1",
        cursor: query.get("cursor"),
      }),
    );
  } catch (error) {
    return error instanceof CollectionError
      ? mobileJson({ error: error.code }, { status: error.status })
      : mobileRequestError(error);
  }
}
export async function POST(request: Request) {
  if (!isSameOrigin(request))
    return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "event:write");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const body = asRecord(await readMobileJson(request));
    if (Object.hasOwn(body, "familyId"))
      return mobileJson({ error: "family_id_not_accepted" }, { status: 400 });
    return mobileJson(
      {
        id: createCollection(
          auth.context,
          body.title as string,
          body.kind as "album" | "chapter",
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    return error instanceof CollectionError
      ? mobileJson({ error: error.code }, { status: error.status })
      : mobileRequestError(error);
  }
}
