import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { isSameOrigin } from "@/lib/security/origin";
import {
  asRecord,
  mobileJson,
  mobileRequestError,
  readMobileJson,
} from "@/lib/mobile/http";
import { BookError } from "@/lib/books/projects/service";
import { changeBookRender, getBookRender } from "@/lib/books/render/jobs";
type Route = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Route) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    return mobileJson(getBookRender(auth.context, (await params).id));
  } catch (e) {
    return e instanceof BookError
      ? mobileJson({ error: e.code }, { status: e.status })
      : mobileRequestError(e);
  }
}
export async function PATCH(request: Request, { params }: Route) {
  if (!isSameOrigin(request))
    return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const body = asRecord(await readMobileJson(request, 1024));
    if (!["cancel", "retry", "remove"].includes(String(body.operation)))
      throw new BookError("invalid_operation");
    return mobileJson(
      await changeBookRender(
        auth.context,
        (await params).id,
        body.operation as "cancel" | "retry" | "remove",
      ),
    );
  } catch (e) {
    return e instanceof BookError
      ? mobileJson({ error: e.code }, { status: e.status })
      : mobileRequestError(e);
  }
}
