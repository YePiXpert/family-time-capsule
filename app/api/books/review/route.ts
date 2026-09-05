import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { isSameOrigin } from "@/lib/security/origin";
import {
  asRecord,
  mobileJson,
  mobileRequestError,
  readMobileJson,
} from "@/lib/mobile/http";
import { BookError } from "@/lib/books/projects/service";
import {
  createAlbumFromReview,
  createBookFromReview,
  getBookReview,
  setBookReviewHighlight,
  type ReviewOptions,
} from "@/lib/books/projects/review";
import type { BookReviewKind } from "@/mobile/src/books/review-types";
export async function GET(request: Request) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const params = new URL(request.url).searchParams;
    return mobileJson(
      getBookReview(auth.context, {
        startDate: params.get("startDate")!,
        endDate: params.get("endDate")!,
        audience: (params.get("audience") ??
          "family") as ReviewOptions["audience"],
        template: (params.get("template") ??
          "growth") as ReviewOptions["template"],
        kind: (params.get("kind") ?? "memory") as BookReviewKind,
        cursor: params.get("cursor"),
      }),
    );
  } catch (e) {
    return e instanceof BookError
      ? mobileJson({ error: e.code }, { status: e.status })
      : mobileRequestError(e);
  }
}
export async function POST(request: Request) {
  if (!isSameOrigin(request))
    return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "event:write");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const body = asRecord(await readMobileJson(request, 32768));
    if (Object.hasOwn(body, "familyId"))
      throw new BookError("family_id_not_accepted");
    const options = {
      startDate: body.startDate,
      endDate: body.endDate,
      audience: body.audience,
      template: body.template,
    } as ReviewOptions;
    if (body.operation === "draft")
      return mobileJson(
        createBookFromReview(auth.context, options, body.selection),
      );
    if (body.operation === "album")
      return mobileJson(
        createAlbumFromReview(auth.context, options, body.selection),
      );
    if (body.operation === "highlight") {
      setBookReviewHighlight(
        auth.context,
        options,
        body.id as string,
        body.selected as boolean,
      );
      return mobileJson({ ok: true });
    }
    throw new BookError("invalid_operation");
  } catch (e) {
    return e instanceof BookError
      ? mobileJson({ error: e.code }, { status: e.status })
      : mobileRequestError(e);
  }
}
