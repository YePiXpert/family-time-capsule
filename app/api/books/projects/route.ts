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
  createBookProject,
  listBookProjects,
} from "@/lib/books/projects/service";
import type { BookAudience, BookTemplate } from "@/mobile/src/books/types";
export async function GET(request: Request) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const query = new URL(request.url).searchParams;
    return mobileJson(
      listBookProjects(auth.context, {
        cursor: query.get("cursor"),
        deleted: query.get("deleted") === "1",
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
    const body = asRecord(await readMobileJson(request));
    if (Object.hasOwn(body, "familyId"))
      throw new BookError("family_id_not_accepted");
    return mobileJson(
      {
        id: createBookProject(
          auth.context,
          body.title as string,
          body.template as BookTemplate,
          body.audience as BookAudience,
        ),
      },
      { status: 201 },
    );
  } catch (e) {
    return e instanceof BookError
      ? mobileJson({ error: e.code }, { status: e.status })
      : mobileRequestError(e);
  }
}
