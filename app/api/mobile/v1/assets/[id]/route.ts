import { deleteLibraryAsset } from "@/lib/assets/deletion";
import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { getLibraryAsset, editLibraryAsset, AssetLibraryError } from "@/lib/assets/library";
import { asRecord, mobileJson, readMobileJson } from "@/lib/mobile/http";
import { isSameOrigin } from "@/lib/security/origin";
import { libraryError } from "@/lib/assets/library-http";
type Route = { params: Promise<{ id: string }> };
export async function GET(request: Request, route: Route) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  try { return mobileJson(getLibraryAsset(auth.context, (await route.params).id)); }
  catch (error) { return libraryError(error); }
}
export async function PATCH(request: Request, route: Route) {
  if (!isSameOrigin(request)) return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "event:write");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const body = asRecord(await readMobileJson(request, 8192));
    if (Object.hasOwn(body, "familyId")) throw new AssetLibraryError("invalid_input");
    return mobileJson(editLibraryAsset(auth.context, (await route.params).id, body.revision as number, { ...(body.capturedAt === undefined ? {} : { capturedAt: body.capturedAt as string | null }), ...(body.participantIds === undefined ? {} : { participantIds: body.participantIds as string[] }) }));
  } catch (error) { return libraryError(error); }
}

export async function DELETE(request: Request, route: Route) {
  if (!isSameOrigin(request)) return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "event:write");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const body = asRecord(await readMobileJson(request, 1024));
    const result = deleteLibraryAsset(auth.context, (await route.params).id, body.confirmed === true);
    return mobileJson(result, { status: result.cleanupPending ? 202 : 200 });
  } catch (error) { return libraryError(error); }
}
