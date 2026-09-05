import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { asset } from "@/db/schema/asset";
import { person } from "@/db/schema/family";
import { memoryEvent } from "@/db/schema/memory";
import { contribution, fact } from "@/db/schema/contribution";
import { assetTranscript } from "@/db/schema/transcript";
import { story, storyParagraph, storySource } from "@/db/schema/story";
import { factSource } from "@/db/schema/suggestion";
import { capsule } from "@/db/schema/capsule";
import type { FamilyContext } from "@/lib/family/context";
import {
  createContributionAccessSnapshot,
  getVisibleContributionInTransaction,
  readableAssetPredicate,
} from "@/lib/authz/contribution-access";
import { getCollection } from "@/lib/collections/service";
import { isCapsuleUnlocked } from "@/lib/capsules/service";
import { formatAgeLabel } from "@/lib/memories/age";
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
  story: "storyId",
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
  const familyChild = db
    .select()
    .from(person)
    .where(and(eq(person.familyId, context.familyId), eq(person.isChild, true)))
    .get();
  function assetDescendants(id: string) {
    return sql`with recursive book_asset_tree(id) as (
      select id from asset where id=${id} and family_id=${context.familyId}
      union select a.id from asset a join book_asset_tree t on a.original_asset_id=t.id where a.family_id=${context.familyId}
    ) select id from book_asset_tree`;
  }
  function closedCapsule(
    kind: "memory" | "asset" | "contribution",
    id: string,
  ) {
    const table =
        kind === "memory"
          ? "capsule_event"
          : kind === "asset"
            ? "capsule_asset"
            : "capsule_contribution",
      column =
        kind === "memory"
          ? "memory_event_id"
          : kind === "asset"
            ? "asset_id"
            : "contribution_id";
    const rows = db
      .select()
      .from(capsule)
      .where(
        and(
          eq(capsule.familyId, context.familyId),
          sql`${capsule.id} in (select capsule_id from ${sql.identifier(table)} where family_id=${context.familyId} and ${kind === "asset" ? sql`${sql.identifier(column)} in (${assetDescendants(id)})` : sql`${sql.identifier(column)}=${id}`})`,
        ),
      )
      .all();
    return rows.some(
      (row) =>
        !isCapsuleUnlocked(
          row,
          familyChild?.birthDate ?? null,
          context.familyTimezone,
        ),
    );
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
              isNull(memoryEvent.deletedAt),
            ),
          )
          .get();
        if (row && !closedCapsule("memory", id)) {
          const child = db
            .select()
            .from(person)
            .where(
              and(
                eq(person.id, row.childPersonId),
                eq(person.familyId, context.familyId),
              ),
            )
            .get();
          const notes = db.all<{ rawText: string }>(
            sql`select raw_text rawText from inbox_item where family_id=${context.familyId} and memory_event_id=${id} and raw_text is not null order by created_at,id`,
          );
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
            .filter((assetId) => !closedCapsule("asset", assetId));
          result = {
            state: {
              available: true,
              changed: false,
              label: row.title,
              occurredAt: row.occurredAt.toISOString(),
              ageLabel: child?.birthDate
                ? formatAgeLabel(
                    child.birthDate,
                    row.occurredAt,
                    context.familyTimezone,
                  )
                : null,
              author: null,
              asset: null,
            },
            fingerprint: sourceFingerprint([row, notes]),
            text: notes.map((n) => n.rawText).join("\n\n"),
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
            sql`select c.id from contribution c join memory_event e on e.id=c.memory_event_id where e.family_id=${context.familyId} and c.audio_asset_id in (${assetDescendants(id)}) and c.deleted_at is null and c.visibility!='family' limit 1`,
          );
        if (
          row &&
          event &&
          !narrow &&
          !closedCapsule("asset", id) &&
          resolve("memory", event.id).state.available
        )
          result = {
            state: {
              available: true,
              changed: false,
              label: row.originalFilename,
              occurredAt: row.capturedAt?.toISOString() ?? null,
              ageLabel: null,
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
              event.id,
            ]),
            text: "",
            images: row.type === "image" ? [id] : [],
            eventId: event.id,
          };
      } else if (kind === "contribution") {
        const row = db.transaction((tx) =>
          getVisibleContributionInTransaction(tx, snapshot, id),
        );
        if (
          row &&
          (audience === "personal" || row.visibility === "family") &&
          !closedCapsule("contribution", id)
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
      } else if (kind === "story") {
        const row = db
          .select()
          .from(story)
          .where(
            and(
              eq(story.id, id),
              eq(story.familyId, context.familyId),
              eq(story.status, "published"),
              isNull(story.deletedAt),
            ),
          )
          .get();
        if (row) {
          const paragraphs = db
            .select()
            .from(storyParagraph)
            .where(
              and(
                eq(storyParagraph.storyId, id),
                eq(storyParagraph.familyId, context.familyId),
              ),
            )
            .orderBy(storyParagraph.position)
            .all();
          const sources = db
            .select()
            .from(storySource)
            .where(
              and(
                eq(storySource.familyId, context.familyId),
                sql`${storySource.paragraphId} in(select id from story_paragraph where story_id=${id})`,
              ),
            )
            .all();
          const dependencies: unknown[] = [];
          const allowed = sources.every((s) => {
            if (s.sourceType === "user_text") return true;
            if (!s.sourceId) return false;
            if (
              s.sourceType === "contribution" ||
              s.sourceType === "memory_event"
            ) {
              const r = resolve(
                s.sourceType === "contribution" ? "contribution" : "memory",
                s.sourceId,
              );
              dependencies.push(r.fingerprint);
              return r.state.available;
            }
            if (s.sourceType === "transcript") {
              const transcript = db
                .select()
                .from(assetTranscript)
                .where(
                  and(
                    eq(assetTranscript.id, s.sourceId),
                    eq(assetTranscript.familyId, context.familyId),
                  ),
                )
                .get();
              if (!transcript) return false;
              const r = resolve("asset", transcript.assetId);
              dependencies.push([r.fingerprint, transcript]);
              return r.state.available;
            }
            if (s.sourceType === "fact") {
              const f = db
                .select()
                .from(fact)
                .where(
                  and(
                    eq(fact.id, s.sourceId),
                    eq(fact.status, "user_confirmed"),
                  ),
                )
                .get();
              if (!f || !resolve("memory", f.memoryEventId).state.available)
                return false;
              const refs = db
                .select()
                .from(factSource)
                .where(
                  and(
                    eq(factSource.factId, f.id),
                    eq(factSource.familyId, context.familyId),
                  ),
                )
                .all();
              dependencies.push(f);
              return refs.every((ref) => {
                if (ref.sourceType === "user_text") return true;
                if (!ref.sourceId) return false;
                if (ref.sourceType === "contribution") {
                  const r = resolve("contribution", ref.sourceId);
                  dependencies.push(r.fingerprint);
                  return r.state.available;
                }
                let assetId = ref.sourceId;
                if (ref.sourceType === "transcript") {
                  const t = db
                    .select()
                    .from(assetTranscript)
                    .where(
                      and(
                        eq(assetTranscript.id, ref.sourceId),
                        eq(assetTranscript.familyId, context.familyId),
                      ),
                    )
                    .get();
                  if (!t) return false;
                  assetId = t.assetId;
                  dependencies.push(t);
                }
                const r = resolve("asset", assetId);
                dependencies.push(r.fingerprint);
                return r.state.available;
              });
            }
            return false;
          });
          if (allowed)
            result = {
              state: {
                ...unavailable().state,
                available: true,
                label: row.title,
              },
              fingerprint: sourceFingerprint([
                row,
                paragraphs,
                sources,
                dependencies,
              ]),
              text: paragraphs.map((p) => p.text).join("\n\n"),
              images: [],
              eventId: null,
            };
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
