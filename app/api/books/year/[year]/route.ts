import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { getFamily } from "@/lib/family/service";
import { generateYearBook } from "@/lib/books/service";

/**
 * GET /api/books/year/[year]?format=pdf|epub —— 某一年的事件成书（M6）。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ year: string }> },
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
  const { year: yearRaw } = await params;
  const year = Number(yearRaw);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    return Response.json({ error: "invalid_year" }, { status: 400 });
  }
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "epub" ? "epub" : "pdf";

  const family = await getFamily(context.familyId);
  const result = await generateYearBook(
    context.familyId,
    year,
    format,
    family?.name ?? "家庭",
  );
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "content-type": result.contentType,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
      "cache-control": "no-store",
    },
  });
}
