import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { getReadingManifest } from "@/lib/reading/service";
import { BookError } from "@/lib/books/projects/service";
import { CollectionError } from "@/lib/collections/service";
import { mobileJson, mobileRequestError } from "@/lib/mobile/http";
import type { ReadingKind } from "@/mobile/src/reading/types";
import { GET as readMedia } from "@/app/api/media/[assetId]/route";
export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ kind: string; id: string; assetId: string }> },
) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const { kind, id, assetId } = await params,
      manifest = getReadingManifest(auth.context, kind as ReadingKind, id);
    if (new URL(request.url).searchParams.get("digest") !== manifest.digest)
      throw new BookError("source_changed", 409);
    if (!manifest.media.some((m) => m.id === assetId))
      throw new BookError("not_found", 404);
    return readMedia(request, { params: Promise.resolve({ assetId }) });
  } catch (e) {
    return e instanceof BookError || e instanceof CollectionError
      ? mobileJson({ error: e.code }, { status: e.status })
      : mobileRequestError(e);
  }
}
