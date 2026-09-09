
import { createEventAccessSnapshot, eventVisibilityCondition } from "@/lib/authz/event-access";
import { readableName } from "@/lib/naming";
import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { asset } from "@/db/schema/asset";
import { person } from "@/db/schema/family";
import { memoryEvent } from "@/db/schema/memory";
import { contribution } from "@/db/schema/contribution";


import type { FamilyContext } from "@/lib/family/context";
import {
  createContributionAccessSnapshot,
  getVisibleContributionInTransaction,
  readableAssetPredicate,
  familyReviewAssetPredicate,
} from "@/lib/authz/contribution-access";
import { getCollection } from "@/lib/collections/service";

import { formatPersonAgeLabel } from "@/lib/memories/age";
import type {
  BookAudience,
  BookSourceKind,
  BookSourceRef,
  BookSourceState,
} from "@/mobile/src/books/types";
export const SOURCE_FIELDS = {
  memory: "memoryEventId",
  asset: "assetId",
  contribution: "contributionId",
  collection: "collectionId",
} as const;
export function bookSourceTarget(ref: BookSourceRef) {
  return ref[SOURCE_FIELDS[ref.kind]];
}
export function sourceFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export type ResolvedBookSource = {
  state: BookSourceState;
  fingerprint: string;
  text: string;
  images: string[];
  eventId: string | null;
};
const unavailable = (): ResolvedBookSource => ({
  state: {
    available: false,
    changed: false,
    label: "来源已删除或当前不可见",
    occurredAt: null,
    ageLabel: null,
    author: null,
    asset: null,
  },
  fingerprint: "",
  text: "",
  images: [],
  eventId: null,
});
/** Each request evaluates its real principal and intended audience separately. No synthetic admin/viewer context. */
export function createBookSourceResolver(
  context: FamilyContext,
  audience: BookAudience,
) {
  const db = getDb(),
    snapshot = createContributionAccessSnapshot(context),
    cache = new Map<string, ResolvedBookSource>(),
    visiting = new Set<string>();
  function assetDescendants(id: string) {
    return sql`with recursive book_asset_tree(id) as (
      select id from asset where id=${id} and family_id=${context.familyId}
      union select a.id from asset a join book_asset_tree t on a.original_asset_id=t.id where a.family_id=${context.familyId}
    ) select id from book_asset_tree`;
  }

  function resolve(
    kind: BookSourceKind,
    id: string | null,
  ): ResolvedBookSource {
    if (!id) return unavailable();
    const key = `${kind}:${id}`;
    if (cache.has(key)) return cache.get(key)!;
    if (visiting.has(key) || visiting.size > 12) return unavailable();
    visiting.add(key);
    let result = unavailable();
    try {
      if (kind === "memory") {
        const row = db
          .select()
          .from(memoryEvent)
          .where(
            and(
              eq(memoryEvent.id, id),
              eq(memoryEvent.familyId, context.familyId),
              eq(memoryEvent.status, "confirmed"),
              eventVisibilityCondition(createEventAccessSnapshot(context)),
              audience === "family" ? eq(memoryEvent.visibility, "family") : undefined,
              isNull(memoryEvent.deletedAt),
            ),
          )
          .get();
        if (row) {
          const child = row.childPersonId === null ? undefined : db
            .select()
            .from(person)
            .where(
              and(
                eq(person.id, row.childPersonId),
                eq(person.familyId, context.familyId),
              ),
            )
            .get();
          const images = db
            .select({ id: asset.id })
            .from(asset)
            .where(
              and(
                eq(asset.familyId, context.familyId),
                eq(asset.type, "image"),
                isNull(asset.originalAssetId),
                sql`${asset.id} in(select asset_id from memory_event_asset where memory_event_id=${id} and family_id=${context.familyId})`,
                readableAssetPredicate(snapshot, sql`${asset.id}`),
              ),
            )
            .all()
            .map((a) => a.id)
            ;
          result = {
            state: {
              available: true,
              changed: false,
              label: row.title,
              occurredAt: row.occurredAt.toISOString(),
              ageLabel: child?.birthDate
                ? formatPersonAgeLabel(
                    child,
                    row.occurredAt,
                    context.familyTimezone,
                  )
                : null,
              author: null,
              asset: null,
            },
            fingerprint: sourceFingerprint(row),
            text: row.bodyText,
            images,
            eventId: id,
          };
        }
      } else if (kind === "asset") {
        const row = db
          .select()
          .from(asset)
          .where(
            and(
              eq(asset.id, id),
              eq(asset.familyId, context.familyId),
              isNull(asset.originalAssetId),
              readableAssetPredicate(snapshot, sql`${asset.id}`),
            ),
          )
          .get();
        const event = db.get<{ id: string }>(
          sql`select e.id from memory_event e where e.family_id=${context.familyId} and e.deleted_at is null and e.status='confirmed' and (exists(select 1 from memory_event_asset m where m.memory_event_id=e.id and m.asset_id=${id} and m.family_id=e.family_id) or exists(select 1 from contribution c where c.memory_event_id=e.id and c.audio_asset_id=${id} and c.deleted_at is null)) order by e.id limit 1`,
        );
        const narrow =
          audience === "family" &&
          db.get(
            sql`select c.id from contribution c join memory_event e on e.id=c.memory_event_id where e.family_id=${context.familyId} and c.audio_asset_id in (${assetDescendants(id)}) and c.visibility!='family' limit 1`,
          );
        if (
          row &&
          !narrow &&
          (audience === "personal" || row.visibility === "family" || (event && resolve("memory", event.id).state.available) || Boolean(db.get(sql`select 1 where ${familyReviewAssetPredicate(context.familyId, sql`${id}`)}`))) &&
          (!event || resolve("memory", event.id).state.available)
        )
          result = {
            state: {
              available: true,
              changed: false,
              label: readableName({ title: row.displayName, source: row.nameSource, mediaType: row.type, originalFilename: row.originalFilename, capturedAt: row.capturedAt, timeSource: row.timeSource, timezone: context.familyTimezone }).text,
              occurredAt: event ? resolve("memory",event.id).state.occurredAt : ["user_confirmed", "embedded_metadata"].includes(row.timeSource) ? row.capturedAt?.toISOString() ?? null : null,
              capturedAt: ["user_confirmed", "embedded_metadata"].includes(row.timeSource) ? row.capturedAt?.toISOString() ?? null : null,
              ageLabel: event ? resolve("memory",event.id).state.ageLabel : null,
              author: null,
              asset: {
                id: row.id,
                filename: row.originalFilename,
                mimeType: row.mimeType,
                type: row.type,
                width: row.width,
                height: row.height,
                bytes: row.bytes,
                previewAssetId:
                  db.get<{ id: string }>(
                    sql`select id from asset where family_id=${context.familyId} and original_asset_id=${row.id} and derivative_type in ('preview','thumbnail') order by case derivative_type when 'preview' then 0 else 1 end,created_at desc,id desc limit 1`,
                  )?.id ?? null,
              },
            },
            fingerprint: sourceFingerprint([
              row.sha256,
              row.width,
              row.height,
              event?.id ?? null, row.nameRevision, row.metadataRevision,
            ]),
            text: "",
            images: row.type === "image" ? [id] : [],
            eventId: event?.id ?? null,
          };
      } else if (kind === "contribution") {
        const row = db.transaction((tx) =>
          getVisibleContributionInTransaction(tx, snapshot, id),
        );
        if (
          row &&
          (audience === "personal" || row.visibility === "family")
        ) {
          const original = db
              .select()
              .from(contribution)
              .where(eq(contribution.id, id))
              .get()!,
            event = resolve("memory", row.memoryEventId);
          const author = db
            .select()
            .from(person)
            .where(
              and(
                eq(person.id, original.authorPersonId),
                eq(person.familyId, context.familyId),
              ),
            )
            .get();
          if (event.state.available && author)
            result = {
              state: {
                ...event.state,
                label: `${author.displayName}的讲述`,
                author: author.displayName,
                authoredAt: original.createdAt.toISOString(),
              },
              fingerprint: sourceFingerprint(original),
              text:
                original.editedText ??
                original.rawText ??
                original.transcript ??
                "",
              images: [],
              eventId: row.memoryEventId,
            };
        }
      } else if (kind === "collection") {
        try {
          const doc = getCollection(context, id);
          if (!doc.deletedAt)
            result = {
              state: {
                ...unavailable().state,
                available: true,
                label: doc.title,
              },
              fingerprint: sourceFingerprint([
                doc.revision,
                doc.items.map((i) => [i.memoryEventId, i.source?.occurredAt]),
              ]),
              text: doc.description,
              images: [],
              eventId: null,
            };
        } catch {
          /* Missing/denied collection stays unavailable. */
        }
      }
    } finally {
      visiting.delete(key);
    }
    cache.set(key, result);
    return result;
  }
  return resolve;
}
