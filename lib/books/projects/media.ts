import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { asset } from "@/db/schema/asset";
import type { FamilyContext } from "@/lib/family/context";
import type { BookDetail } from "@/mobile/src/books/types";
import { createBookSourceResolver, sourceFingerprint } from "./sources";
/** Supplementary AV/documents of selected memories/voices. Images remain explicitly laid out. */
export function collectBookReadingMedia(
  context: FamilyContext,
  book: BookDetail,
) {
  const used = new Set(book.blocks.flatMap((b) => b.sourceIds)),
    candidates = new Set<string>(),
    resolve = createBookSourceResolver(context, book.audience);
  for (const ref of book.sources.filter((s) => used.has(s.id))) {
    if (ref.kind === "asset" && ref.assetId) candidates.add(ref.assetId);
    if (ref.kind === "memory" && ref.memoryEventId) {
      const rows = getDb().all<{
        id: string;
      }>(sql`select a.asset_id id from memory_event_asset a where a.family_id=${context.familyId} and a.memory_event_id=${ref.memoryEventId}
    union select c.audio_asset_id id from contribution c join memory_event e on e.id=c.memory_event_id where e.family_id=${context.familyId} and e.id=${ref.memoryEventId} and c.deleted_at is null and c.audio_asset_id is not null`);
      rows.forEach((r) => candidates.add(r.id));
    }
    if (ref.kind === "contribution" && ref.contributionId) {
      const row = getDb().get<{ id: string | null }>(
        sql`select c.audio_asset_id id from contribution c join memory_event e on e.id=c.memory_event_id where e.family_id=${context.familyId} and c.id=${ref.contributionId} and c.deleted_at is null`,
      );
      if (row?.id) candidates.add(row.id);
    }
  }
  return [...candidates].sort().flatMap((id) => {
    const resolved = resolve("asset", id);
    if (
      !resolved.state.available ||
      !resolved.state.asset ||
      resolved.state.asset.type === "image"
    )
      return [];
    const row = getDb()
      .select()
      .from(asset)
      .where(and(eq(asset.id, id), eq(asset.familyId, context.familyId)))
      .get();
    const voices = getDb()
      .all<{ id: string }>(
        sql`select c.id from contribution c join memory_event e on e.id=c.memory_event_id where e.family_id=${context.familyId} and c.audio_asset_id=${id} and c.deleted_at is null order by c.created_at,c.id`,
      )
      .map((c) => resolve("contribution", c.id))
      .filter((c) => c.state.available);
    const label = [
      resolved.state.label,
      ...voices.map((v) =>
        [
          v.state.author,
          v.state.authoredAt
            ? `讲述于 ${new Intl.DateTimeFormat("zh-CN", { timeZone: context.familyTimezone, dateStyle: "long" }).format(new Date(v.state.authoredAt))}`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
      ),
    ].join(" · ");
    return row
      ? [
          {
            asset: row,
            state: { ...resolved.state, label },
            fingerprint: sourceFingerprint([
              resolved.fingerprint,
              voices.map((v) => v.fingerprint),
              label,
            ]),
            eventId: resolved.eventId,
          },
        ]
      : [];
  });
}
