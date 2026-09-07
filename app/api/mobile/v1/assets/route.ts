import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { AssetLibraryError, listLibraryAssets, addLibraryAssetsToDraft, addLibraryAssetsToMemory } from "@/lib/assets/library";
import { addAssetsToCollection } from "@/lib/collections/service";
import { libraryError } from "@/lib/assets/library-http";
import { asRecord, mobileJson, readMobileJson } from "@/lib/mobile/http";
import { isSameOrigin } from "@/lib/security/origin";
export async function GET(request: Request) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  const query = new URL(request.url).searchParams;
  try { return mobileJson(listLibraryAssets(auth.context, { cursor: query.get("cursor"), type: query.get("type") })); }
  catch (error) { return libraryError(error); }
}
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "capture:create");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const body = asRecord(await readMobileJson(request, 32768));
    if (Object.hasOwn(body, "familyId") || typeof body.targetId !== "string" || !Array.isArray(body.assetIds) || body.assetIds.some(id => typeof id !== "string")) throw new AssetLibraryError("invalid_input");
    const ids = body.assetIds as string[];
    if (body.operation === "draft") return mobileJson(addLibraryAssetsToDraft(auth.context, ids, body.targetId, body.revision as number, body.mutationId as string));
    if (body.operation === "memory") { addLibraryAssetsToMemory(auth.context, ids, body.targetId); return mobileJson({ id: body.targetId }); }
    if (body.operation === "collection") return mobileJson(addAssetsToCollection(auth.context, body.targetId, body.revision as number, ids));
    throw new AssetLibraryError("invalid_operation");
  } catch (error) { return libraryError(error); }
}
