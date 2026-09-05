import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { isSameOrigin } from "@/lib/security/origin";
import {
  asRecord,
  mobileJson,
  mobileRequestError,
  readMobileJson,
} from "@/lib/mobile/http";
import { BookError } from "@/lib/books/projects/service";
import { listBookRenders, requestBookRender } from "@/lib/books/render/jobs";
import type { BookRenderFormat } from "@/lib/books/render/types";
type Route = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Route) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    return mobileJson({
      jobs: listBookRenders(auth.context, (await params).id),
    });
  } catch (e) {
    return e instanceof BookError
      ? mobileJson({ error: e.code }, { status: e.status })
      : mobileRequestError(e);
  }
}
export async function POST(request: Request, { params }: Route) {
  if (!isSameOrigin(request))
    return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const body = asRecord(await readMobileJson(request, 2048));
    if (Object.hasOwn(body, "familyId") || Object.hasOwn(body, "audience"))
      throw new BookError("scope_from_project_required");
    return mobileJson(
      requestBookRender(
        auth.context,
        (await params).id,
        body.revision as number,
        body.format as BookRenderFormat,
      ),
      { status: 202 },
    );
  } catch (e) {
    return e instanceof BookError
      ? mobileJson({ error: e.code }, { status: e.status })
      : mobileRequestError(e);
  }
}
