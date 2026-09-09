import { zonedWallTimeToUtc } from "@/lib/metadata/time";
import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { mobileJson, mobileRequestError } from "@/lib/mobile/http";
import { BookError } from "@/lib/books/projects/service";
import { createBookSourceResolver } from "@/lib/books/projects/sources";
import { getTimelinePage } from "@/lib/memories/service";
import { listCollections } from "@/lib/collections/service";
import type { BookAudience, BookSourceKind } from "@/mobile/src/books/types";
export async function GET(request: Request) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const query = new URL(request.url).searchParams,
      kind = query.get("kind") || "memory",
      audience = query.get("audience") || "family",
      cursor = query.get("cursor");
    if (
      !["personal", "family"].includes(audience) ||
      !["memory", "collection"].includes(kind)
    )
      throw new BookError("invalid_filter");
    const resolve = createBookSourceResolver(
      auth.context,
      audience as BookAudience,
    );
    let rows: { id: string; title: string }[] = [],
      nextCursor: string | null = null;
    if (kind === "memory") {
      const month = query.get("month") || "";
      if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BookError("invalid_filter");
      const nextMonth = month ? new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)), 1)).toISOString().slice(0,7) : "";
      const page = await getTimelinePage(auth.context, { cursor, limit: 24,
        occurredFrom: month ? zonedWallTimeToUtc(`${month}-01T00:00:00`, auth.context.familyTimezone) : undefined,
        occurredBefore: month ? zonedWallTimeToUtc(`${nextMonth}-01T00:00:00`, auth.context.familyTimezone) : undefined,
      });
      rows = page.entries.map((e) => ({
        id: e.event.id,
        title: e.event.title,
      }));
      nextCursor = page.nextCursor;
    } else if (kind === "collection") {
      const page = listCollections(auth.context, { cursor });
      rows = page.entries;
      nextCursor = page.nextCursor;
    }

    return mobileJson({
      entries: rows.flatMap((row) => {
        const state = resolve(kind as BookSourceKind, row.id);
        return state.state.available
          ? [
              {
                ...row,
                kind,
                images: state.images.flatMap((id) => {
                  const asset = resolve("asset", id).state.asset;
                  return asset ? [asset] : [];
                }),
              },
            ]
          : [];
      }),
      nextCursor,
    });
  } catch (e) {
    return e instanceof BookError
      ? mobileJson({ error: e.code }, { status: e.status })
      : mobileRequestError(e);
  }
}
