import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { story } from "@/db/schema/story";
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
      !["memory", "collection", "story"].includes(kind)
    )
      throw new BookError("invalid_filter");
    const resolve = createBookSourceResolver(
      auth.context,
      audience as BookAudience,
    );
    let rows: { id: string; title: string }[] = [],
      nextCursor: string | null = null;
    if (kind === "memory") {
      const page = await getTimelinePage(auth.context, { cursor, limit: 24 });
      rows = page.entries.map((e) => ({
        id: e.event.id,
        title: e.event.title,
      }));
      nextCursor = page.nextCursor;
    } else if (kind === "collection") {
      const page = listCollections(auth.context, { cursor });
      rows = page.entries;
      nextCursor = page.nextCursor;
    } else {
      let after: { at: number; id: string } | null = null;
      if (cursor) {
        try {
          after = JSON.parse(Buffer.from(cursor, "base64url").toString());
          if (
            !after ||
            !Number.isSafeInteger(after.at) ||
            typeof after.id !== "string"
          )
            throw new Error();
        } catch {
          throw new BookError("invalid_cursor");
        }
      }
      const all = getDb()
        .select()
        .from(story)
        .where(
          and(
            eq(story.familyId, auth.context.familyId),
            eq(story.status, "published"),
            isNull(story.deletedAt),
            after
              ? sql`(${story.updatedAt},${story.id})<(${after.at},${after.id})`
              : undefined,
          ),
        )
        .orderBy(desc(story.updatedAt), desc(story.id))
        .limit(25)
        .all();
      rows = all.slice(0, 24);
      const last = rows.at(-1) && all[23];
      nextCursor =
        all.length > 24 && last
          ? Buffer.from(
              JSON.stringify({
                at: last.updatedAt.getTime() / 1000,
                id: last.id,
              }),
            ).toString("base64url")
          : null;
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
