import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  collection,
  collectionItem,
  collectionSection,
} from "@/db/schema/collection";
import { memoryEvent } from "@/db/schema/memory";
import type { FamilyContext } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import {
  createContributionAccessSnapshot,
  readableAssetPredicate,
} from "@/lib/authz/contribution-access";
import type {
  CollectionDetail,
  CollectionEdit,
  CollectionPage,
} from "@/mobile/src/collections/types";
import { CollectionError, validateCollectionEdit } from "./validation";
export { CollectionError } from "./validation";

/** Run inside the same SQLite transaction as mutations; stale contexts fail closed. */
function authorize(context: FamilyContext, write = false) {
  if (
    !hasFamilyCapability(context.role, write ? "event:write" : "archive:view")
  )
    throw new CollectionError("forbidden", 403);
  const row = getDb()
    .get(sql`select u.id from user u join family f on f.id=u.family_id left join person p on p.id=u.person_id and p.family_id=u.family_id
    where u.id=${context.userId} and u.family_id=${context.familyId} and u.disabled_at is null and u.role=${context.role}
    and u.person_id is ${context.personId} and coalesce(p.is_guardian,0)=${Number(context.isGuardian)}
    and f.timezone=${context.familyTimezone} and f.child_later_unlock_age=${context.childLaterUnlockAge}`);
  if (!row) throw new CollectionError("forbidden", 403);
}
function find(context: FamilyContext, id: string) {
  const row = getDb()
    .select()
    .from(collection)
    .where(
      and(eq(collection.id, id), eq(collection.familyId, context.familyId)),
    )
    .get();
  if (!row) throw new CollectionError("not_found", 404);
  return row;
}

export function createCollection(
  context: FamilyContext,
  title: string,
  kind: "album" | "chapter" = "album",
) {
  const edit = validateCollectionEdit({
    title,
    kind,
    description: "",
    coverAssetId: null,
    startDate: null,
    endDate: null,
    sortMode: "manual",
    sections: [],
    items: [],
  });
  return getDb().transaction((tx) => {
    authorize(context, true);
    const id = randomUUID();
    tx.insert(collection)
      .values({
        id,
        familyId: context.familyId,
        title: edit.title,
        kind: edit.kind,
      })
      .run();
    return id;
  });
}

export function getCollection(
  context: FamilyContext,
  id: string,
): CollectionDetail {
  return getDb().transaction((tx) => {
    authorize(context);
    const row = find(context, id);
    const sections = tx
      .select()
      .from(collectionSection)
      .where(
        and(
          eq(collectionSection.collectionId, id),
          eq(collectionSection.familyId, context.familyId),
        ),
      )
      .orderBy(asc(collectionSection.position))
      .all();
    const items = tx
      .select()
      .from(collectionItem)
      .where(
        and(
          eq(collectionItem.collectionId, id),
          eq(collectionItem.familyId, context.familyId),
        ),
      )
      .orderBy(asc(collectionItem.position))
      .all();
    const ids = items.flatMap((i) =>
      i.memoryEventId ? [i.memoryEventId] : [],
    );
    const events = ids.length
      ? tx
          .select()
          .from(memoryEvent)
          .where(
            and(
              eq(memoryEvent.familyId, context.familyId),
              eq(memoryEvent.status, "confirmed"),
              isNull(memoryEvent.deletedAt),
              inArray(memoryEvent.id, ids),
            ),
          )
          .all()
      : [];
    const readable = readableAssetPredicate(
      createContributionAccessSnapshot(context),
      sql`a.id`,
    );
    const covers = tx.all<{
      id: string;
      mediaId: string;
    }>(sql`select a.id,coalesce((select id from asset t where t.original_asset_id=a.id and t.family_id=${context.familyId} and t.derivative_type='thumbnail' order by t.created_at desc,t.id desc limit 1),a.id) as mediaId
      from asset a where a.id in (select value from json_each(${JSON.stringify([row.coverAssetId, ...events.map((e) => e.coverAssetId)].filter(Boolean))})) and ${readable}
      and exists (select 1 from memory_event_asset ma where ma.family_id=${context.familyId} and (ma.asset_id=a.id or ma.asset_id=a.original_asset_id) and ma.memory_event_id in (select value from json_each(${JSON.stringify(events.map((e) => e.id))})))`);
    const coverMap = new Map(covers.map((a) => [a.id, a.mediaId]));
    const eventMap = new Map(events.map((e) => [e.id, e]));
    const mapped = items.map((item) => {
      const event = item.memoryEventId
        ? eventMap.get(item.memoryEventId)
        : undefined;
      return {
        id: item.id,
        memoryEventId: item.memoryEventId,
        sectionId: item.sectionId,
        caption: item.caption,
        source: event
          ? {
              title: event.title,
              occurredAt: event.occurredAt.toISOString(),
              coverAssetId:
                event.coverAssetId && coverMap.has(event.coverAssetId)
                  ? event.coverAssetId
                  : null,
              previewAssetId: event.coverAssetId
                ? (coverMap.get(event.coverAssetId) ?? null)
                : null,
            }
          : null,
      };
    });

    return {
      id: row.id,
      timezone: context.familyTimezone,
      title: row.title,
      description: row.description,
      kind: row.kind as CollectionEdit["kind"],
      coverAssetId:
        row.coverAssetId && coverMap.has(row.coverAssetId)
          ? row.coverAssetId
          : null,
      startDate: row.startDate,
      endDate: row.endDate,
      sortMode: row.sortMode as CollectionEdit["sortMode"],
      revision: row.revision,
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
      sections: sections.map(({ id, title }) => ({ id, title })),
      items: mapped,
      canWrite: hasFamilyCapability(context.role, "event:write"),
    };
  });
}

export function listCollections(
  context: FamilyContext,
  options: { deleted?: boolean; cursor?: string | null } = {},
): CollectionPage {
  authorize(context);
  let cursor: { at: number; id: string } | null = null;
  if (options.cursor) {
    try {
      cursor = JSON.parse(Buffer.from(options.cursor, "base64url").toString());
      if (
        !cursor ||
        !Number.isSafeInteger(cursor.at) ||
        typeof cursor.id !== "string" ||
        cursor.id.length > 128
      )
        throw new Error();
    } catch {
      throw new CollectionError("invalid_cursor");
    }
  }
  const rows = getDb()
    .select()
    .from(collection)
    .where(
      and(
        eq(collection.familyId, context.familyId),
        options.deleted
          ? sql`${collection.deletedAt} is not null`
          : isNull(collection.deletedAt),
        cursor
          ? sql`(${collection.updatedAt},${collection.id}) < (${cursor.at},${cursor.id})`
          : undefined,
      ),
    )
    .orderBy(desc(collection.updatedAt), desc(collection.id))
    .limit(31)
    .all();
  const page = rows.slice(0, 30),
    ids = page.map((r) => r.id);
  const counts = ids.length
    ? getDb().all<{ id: string; count: number }>(
        sql`select ci.collection_id as id,count(*) as count from collection_item ci join memory_event e on e.id=ci.memory_event_id where ci.collection_id in (select value from json_each(${JSON.stringify(ids)})) and ci.family_id=${context.familyId} and e.family_id=${context.familyId} and e.status='confirmed' and e.deleted_at is null group by ci.collection_id`,
      )
    : [];
  const readable = readableAssetPredicate(
    createContributionAccessSnapshot(context),
    sql`a.id`,
  );
  const covers = ids.length
    ? getDb().all<{ id: string; assetId: string }>(
        sql`select c.id,coalesce((select id from asset t where t.original_asset_id=a.id and t.family_id=${context.familyId} and t.derivative_type='thumbnail' order by t.created_at desc,t.id desc limit 1),a.id) as assetId from collection c join asset a on a.id=c.cover_asset_id where c.id in (select value from json_each(${JSON.stringify(ids)})) and c.family_id=${context.familyId} and ${readable}
        and exists(select 1 from collection_item ci join memory_event e on e.id=ci.memory_event_id join memory_event_asset ma on ma.memory_event_id=e.id where ci.collection_id=c.id and ci.family_id=${context.familyId} and e.family_id=${context.familyId} and ma.family_id=${context.familyId} and ma.asset_id=a.id and e.status='confirmed' and e.deleted_at is null)`,
      )
    : [];
  const last = page.at(-1);
  return {
    entries: page.map((row) => ({
      id: row.id,
      title: row.title,
      kind: row.kind as CollectionEdit["kind"],
      description: row.description,
      count: counts.find((c) => c.id === row.id)?.count ?? 0,
      coverAssetId: covers.find((c) => c.id === row.id)?.assetId ?? null,
      revision: row.revision,
      deletedAt: row.deletedAt?.toISOString() ?? null,
    })),
    nextCursor:
      rows.length > 30 && last
        ? Buffer.from(
            JSON.stringify({
              at: last.updatedAt.getTime() / 1000,
              id: last.id,
            }),
          ).toString("base64url")
        : null,
    canWrite: hasFamilyCapability(context.role, "event:write"),
  };
}

export function saveCollection(
  context: FamilyContext,
  id: string,
  revision: number,
  input: unknown,
) {
  const edit = validateCollectionEdit(input);
  getDb().transaction((tx) => {
    authorize(context, true);
    const current = find(context, id);
    if (current.revision !== revision)
      throw new CollectionError("revision_conflict", 409);
    if (current.deletedAt) throw new CollectionError("collection_deleted", 409);
    const previous = tx
      .select()
      .from(collectionItem)
      .where(eq(collectionItem.collectionId, id))
      .all();
    const ids = edit.items.flatMap((i) =>
      i.memoryEventId ? [i.memoryEventId] : [],
    );
    const sources = ids.length
      ? tx
          .select()
          .from(memoryEvent)
          .where(
            and(
              eq(memoryEvent.familyId, context.familyId),
              inArray(memoryEvent.id, ids),
            ),
          )
          .all()
      : [];
    for (const item of edit.items) {
      const source = sources.find((e) => e.id === item.memoryEventId);
      const existing = previous.find(
        (p) => p.id === item.id && p.memoryEventId === item.memoryEventId,
      );
      if (
        (!existing &&
          (!source || source.status !== "confirmed" || source.deletedAt)) ||
        (item.memoryEventId && !source)
      )
        throw new CollectionError("source_unavailable", 404);
    }
    if (edit.coverAssetId) {
      const readable = readableAssetPredicate(
        createContributionAccessSnapshot(context),
        sql`a.id`,
      );
      const cover =
        tx.get(sql`select a.id from asset a where a.id=${edit.coverAssetId} and a.original_asset_id is null and a.type='image' and ${readable}
        and exists(select 1 from memory_event_asset ma join memory_event e on e.id=ma.memory_event_id where ma.asset_id=a.id and ma.family_id=${context.familyId} and e.family_id=${context.familyId} and e.status='confirmed' and e.deleted_at is null and e.id in (select value from json_each(${JSON.stringify(ids)})))`);
      if (!cover) throw new CollectionError("invalid_cover");
    }
    tx.delete(collectionItem).where(eq(collectionItem.collectionId, id)).run();
    tx.delete(collectionSection)
      .where(eq(collectionSection.collectionId, id))
      .run();
    if (edit.sections.length)
      tx.insert(collectionSection)
        .values(
          edit.sections.map((s, position) => ({
            ...s,
            position,
            collectionId: id,
            familyId: context.familyId,
          })),
        )
        .run();
    if (edit.items.length)
      tx.insert(collectionItem)
        .values(
          edit.items.map((item, position) => ({
            ...item,
            position,
            collectionId: id,
            familyId: context.familyId,
          })),
        )
        .run();
    tx.update(collection)
      .set({
        title: edit.title,
        description: edit.description,
        kind: edit.kind,
        coverAssetId: edit.coverAssetId,
        startDate: edit.startDate,
        endDate: edit.endDate,
        sortMode: edit.sortMode,
        revision: revision + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(collection.id, id), eq(collection.revision, revision)))
      .run();
  });
  return getCollection(context, id);
}

export function setCollectionDeleted(
  context: FamilyContext,
  id: string,
  revision: number,
  deleted: boolean,
) {
  getDb().transaction((tx) => {
    authorize(context, true);
    const row = find(context, id);
    if (row.revision !== revision)
      throw new CollectionError("revision_conflict", 409);
    tx.update(collection)
      .set({
        deletedAt: deleted ? new Date() : null,
        revision: revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(collection.id, id))
      .run();
  });
  return getCollection(context, id);
}
