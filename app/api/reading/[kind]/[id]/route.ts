import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { getReadingManifest } from "@/lib/reading/service";
import { BookError } from "@/lib/books/projects/service";
import { CollectionError } from "@/lib/collections/service";
import { mobileJson, mobileRequestError } from "@/lib/mobile/http";
import type { ReadingKind } from "@/mobile/src/reading/types";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const { kind, id } = await params;
    return mobileJson(
      getReadingManifest(auth.context, kind as ReadingKind, id),
    );
  } catch (e) {
    return e instanceof BookError || e instanceof CollectionError
      ? mobileJson({ error: e.code }, { status: e.status })
      : mobileRequestError(e);
  }
}
