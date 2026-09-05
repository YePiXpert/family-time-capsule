import { withCompatibilityRender } from "@/lib/books/render/jobs";
import { BookError } from "@/lib/books/projects/service";
import { mobileRequestError } from "@/lib/mobile/http";
import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { getFamily } from "@/lib/family/service";
import { generateStoryBook } from "@/lib/books/service";

/**
 * GET /api/books/story/[id]?format=pdf|epub —— 已发布故事成书（M6）。
 * 媒体内嵌于文件本身，不引用任何内部鉴权 URL。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeApiFamilyRequest(
    request.headers,
    "archive:view",
  );
  if (!authorization.ok) {
    return Response.json(
      { error: authorization.error },
      { status: authorization.status },
    );
  }
  const { context } = authorization;
  const { id } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "epub" ? "epub" : "pdf";

  try {
    const family = await getFamily(context.familyId);
    const result = await withCompatibilityRender(() =>
      generateStoryBook(
        context.familyId,
        id,
        format,
        family?.name ?? "家庭",
        context,
      ),
    );
    if (!result.ok) {
      const status =
        result.error === "story_not_found"
          ? 404
          : result.error === "story_not_published"
            ? 409
            : 400;
      return Response.json({ error: result.error }, { status });
    }

    return new Response(new Uint8Array(result.buffer), {
      headers: {
        "content-type": result.contentType,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return e instanceof BookError
      ? Response.json({ error: e.code }, { status: e.status })
      : mobileRequestError(e);
  }
}
