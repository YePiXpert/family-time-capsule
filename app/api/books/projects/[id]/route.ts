import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { isSameOrigin } from "@/lib/security/origin";
import {
  asRecord,
  mobileJson,
  mobileRequestError,
  readMobileJson,
} from "@/lib/mobile/http";
import {
  BookError,
  copyBookProject,
  setBookFinished,
  getBookProject,
  getBookVersion,
  saveBookProject,
  saveBookVersion,
  setBookDeleted,
} from "@/lib/books/projects/service";
import { addBookSelections } from "@/lib/books/projects/select";
type Route = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Route) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params,
      version = new URL(request.url).searchParams.get("version");
    if (version && (!/^\d+$/.test(version) || Number(version) < 1))
      throw new BookError("invalid_revision");
    return mobileJson(
      version
        ? getBookVersion(auth.context, id, Number(version))
        : getBookProject(auth.context, id),
    );
  } catch (e) {
    return e instanceof BookError
      ? mobileJson({ error: e.code }, { status: e.status })
      : mobileRequestError(e);
  }
}
export async function PATCH(request: Request, { params }: Route) {
  if (!isSameOrigin(request))
    return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "event:write");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const body = asRecord(await readMobileJson(request, 2 * 1024 * 1024));
    if (Object.hasOwn(body, "familyId"))
      throw new BookError("family_id_not_accepted");
    if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 1)
      throw new BookError("invalid_revision");
    const { id } = await params,
      revision = Number(body.revision);
    if (body.operation === "copy") return mobileJson(copyBookProject(auth.context, id, revision));
    if (body.operation === "finish" || body.operation === "reopen") return mobileJson(setBookFinished(auth.context, id, revision, body.operation === "finish"));
    if (body.operation === "save")
      return mobileJson(saveBookProject(auth.context, id, revision, body.edit));
    if (body.operation === "add")
      return mobileJson(
        addBookSelections(
          auth.context,
          id,
          revision,
          body.selection,
          body.chapterId as string | undefined,
        ),
      );
    if (body.operation === "snapshot")
      return mobileJson(saveBookVersion(auth.context, id, revision));
    if (body.operation === "delete" || body.operation === "restore")
      return mobileJson(
        setBookDeleted(auth.context, id, revision, body.operation === "delete"),
      );
    throw new BookError("invalid_operation");
  } catch (e) {
    return e instanceof BookError
      ? mobileJson({ error: e.code }, { status: e.status })
      : mobileRequestError(e);
  }
}
