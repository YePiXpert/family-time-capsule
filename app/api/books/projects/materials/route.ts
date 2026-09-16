import { zonedWallTimeToUtc } from "@/lib/metadata/time";
import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { mobileJson, mobileRequestError } from "@/lib/mobile/http";
import { BookError } from "@/lib/books/projects/service";
import { createBookSourceResolver } from "@/lib/books/projects/sources";
import { getTimelinePage } from "@/lib/memories/service";
import { listCollections } from "@/lib/collections/service";
import type { BookAudience, BookSourceKind } from "@/mobile/src/books/types";
import { getDb } from "@/db";
import { memoryEvent } from "@/db/schema/memory";
import { and, eq } from "drizzle-orm";
export async function GET(request: Request) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const query = new URL(request.url).searchParams,
      kind = query.get("kind") || "memory",
      audience = query.get("audience") || "family",
      cursor = query.get("cursor"),
      ids = query.getAll("id");
    if (
      !["personal", "family"].includes(audience) ||
      !["memory", "collection"].includes(kind)
    )
      throw new BookError("invalid_filter");
    if (ids.length && (ids.length > 100 || ids.some(id => !id || id.length > 128) || new Set(ids).size !== ids.length || cursor || query.get("month")))
      throw new BookError("invalid_selection");
    const resolve = createBookSourceResolver(
      auth.context,
      audience as BookAudience,
    );
    let rows: { id: string; title: string }[] = [],
      nextCursor: string | null = null;
    if (ids.length) {
      // Resolve the exact carried selection even when it is outside the first page.
      // Each row still passes the same principal and intended-reader checks below.
      rows = ids.map(id => ({ id, title: "" }));
    } else if (kind === "memory") {
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
        const date = state.state.available && kind === "memory" ? getDb()
          .select({ occurredAtPrecision: memoryEvent.occurredAtPrecision })
          .from(memoryEvent)
          .where(and(eq(memoryEvent.id, row.id), eq(memoryEvent.familyId, auth.context.familyId)))
          .get() : undefined;
        return state.state.available
          ? [
              {
                ...row,
                title: state.state.label,
                kind,
                occurredAt: state.state.occurredAt,
                occurredAtPrecision: date?.occurredAtPrecision,
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
