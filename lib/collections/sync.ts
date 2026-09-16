import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { collection, collectionItem } from "@/db/schema/collection";
import { memoryEvent } from "@/db/schema/memory";
import {
  createEventAccessSnapshot,
  eventVisibilityCondition,
} from "@/lib/authz/event-access";
import type { FamilyContext } from "@/lib/family/context";
import {
  authorizeCollection,
  createCollection,
  getCollection,
  saveCollection,
} from "./service";
import { CollectionError } from "./validation";

export type AlbumSyncCommand = {
  mutationId: string;
  target:
    | {
        clientAlbumId: string;
        title: string;
        publishMetadata: true;
        coverAssetId?: string | null;
      }
    | { collectionId: string; baseRevision: number };
  items: { clientItemId: string; memoryEventId: string }[];
};
export type AlbumSyncResult = {
  id: string;
  revision: number;
  items: { clientItemId: string; itemId: string; memoryEventId: string }[];
};
const validId = (v: unknown): v is string =>
  typeof v === "string" && /^[\w-]{1,128}$/u.test(v);
function parse(input: unknown): AlbumSyncCommand {
  if (!input || typeof input !== "object")
    throw new CollectionError("invalid_input");
  const v = input as AlbumSyncCommand;
  if (
    !validId(v.mutationId) ||
    !v.target ||
    !Array.isArray(v.items) ||
    v.items.length > 100 ||
    v.items.some(
      (i) => !i || !validId(i.clientItemId) || !validId(i.memoryEventId),
    ) ||
    new Set(v.items.map((i) => i.clientItemId)).size !== v.items.length ||
    new Set(v.items.map((i) => i.memoryEventId)).size !== v.items.length
  )
    throw new CollectionError("invalid_input");
  if ("clientAlbumId" in v.target) {
    if (
      !validId(v.target.clientAlbumId) ||
      v.target.publishMetadata !== true ||
      typeof v.target.title !== "string" ||
      !v.target.title.trim() ||
      v.target.title.length > 200 ||
      (v.target.coverAssetId != null && !validId(v.target.coverAssetId))
    )
      throw new CollectionError("metadata_consent_required");
    return {
      mutationId: v.mutationId,
      target: {
        clientAlbumId: v.target.clientAlbumId,
        title: v.target.title.trim(),
        publishMetadata: true,
        coverAssetId: v.target.coverAssetId ?? null,
      },
      items: v.items.map(({ clientItemId, memoryEventId }) => ({
        clientItemId,
        memoryEventId,
      })),
    };
  }
  if (
    !validId(v.target.collectionId) ||
    !Number.isSafeInteger(v.target.baseRevision) ||
    v.target.baseRevision < 1
  )
    throw new CollectionError("invalid_revision");
  return {
    mutationId: v.mutationId,
    target: {
      collectionId: v.target.collectionId,
      baseRevision: v.target.baseRevision,
    },
    items: v.items.map(({ clientItemId, memoryEventId }) => ({
      clientItemId,
      memoryEventId,
    })),
  };
}

/** Add commands never reconstruct the collection from a reader-filtered snapshot. */
export function syncCollection(
  context: FamilyContext,
  input: unknown,
): AlbumSyncResult {
  const command = parse(input);
  const hash = createHash("sha256")
    .update(JSON.stringify(command))
    .digest("hex");
  return getDb().transaction(
    (tx) => {
      authorizeCollection(context, true);
      const receipt = tx.get<{
        collection_id: string;
        payload_hash: string;
        result_json: string;
      }>(
        sql`select collection_id,payload_hash,result_json from collection_sync_mutation where family_id=${context.familyId} and actor_user_id=${context.userId} and mutation_id=${command.mutationId}`,
      );
      const ids = command.items.map((i) => i.memoryEventId);
      const readable = ids.length
        ? tx
            .select({ id: memoryEvent.id })
            .from(memoryEvent)
            .where(
              and(
                eq(memoryEvent.familyId, context.familyId),
                inArray(memoryEvent.id, ids),
                eq(memoryEvent.status, "confirmed"),
                isNull(memoryEvent.deletedAt),
                eventVisibilityCondition(createEventAccessSnapshot(context)),
              ),
            )
            .all()
        : [];
      if (readable.length !== ids.length)
        throw new CollectionError(
          receipt ? "source_unavailable" : "source_unavailable_not_applied",
          403,
        );
      if (receipt) {
        if (receipt.payload_hash !== hash)
          throw new CollectionError("mutation_reused", 409);
        if (getCollection(context, receipt.collection_id).deletedAt)
          throw new CollectionError("collection_deleted", 409);
        return JSON.parse(receipt.result_json) as AlbumSyncResult;
      }
      let id: string;
      if ("clientAlbumId" in command.target) {
        const old = tx.get<{ collection_id: string }>(
          sql`select collection_id from collection_sync_identity where family_id=${context.familyId} and actor_user_id=${context.userId} and client_album_id=${command.target.clientAlbumId}`,
        );
        if (old) throw new CollectionError("album_already_synced", 409);
        id = createCollection(context, command.target.title);
        tx.run(
          sql`insert into collection_sync_identity(family_id,actor_user_id,client_album_id,collection_id) values(${context.familyId},${context.userId},${command.target.clientAlbumId},${id})`,
        );
      } else id = command.target.collectionId;
      const current = getCollection(context, id);
      if (current.deletedAt)
        throw new CollectionError("collection_deleted", 409);
      if (
        "baseRevision" in command.target &&
        current.revision !== command.target.baseRevision
      )
        throw new CollectionError("revision_conflict", 409);
      const existing = tx
        .select()
        .from(collectionItem)
        .where(eq(collectionItem.collectionId, id))
        .all();
      const added = command.items.filter(
        (i) => !existing.some((e) => e.memoryEventId === i.memoryEventId),
      );
      if (existing.length + added.length > 500)
        throw new CollectionError("collection_too_large");
      const mapped = command.items.map((i) => ({
        ...i,
        itemId:
          existing.find((e) => e.memoryEventId === i.memoryEventId)?.id ??
          randomUUID(),
      }));
      const position =
        existing.reduce((m, i) => Math.max(m, i.position), -1) + 1;
      for (const [index, item] of added.entries())
        tx.insert(collectionItem)
          .values({
            id: mapped.find((m) => m.clientItemId === item.clientItemId)!
              .itemId,
            familyId: context.familyId,
            collectionId: id,
            memoryEventId: item.memoryEventId,
            caption: "",
            position: position + index,
          })
          .run();
      tx.update(collection)
        .set({ revision: current.revision + 1, updatedAt: new Date() })
        .where(eq(collection.id, id))
        .run();
      let revision = current.revision + 1;
      if ("clientAlbumId" in command.target && command.target.coverAssetId) {
        const fresh = getCollection(context, id);
        revision = saveCollection(context, id, fresh.revision, {
          ...fresh,
          coverAssetId: command.target.coverAssetId,
        }).revision;
      }
      const result: AlbumSyncResult = { id, revision, items: mapped };
      tx.run(
        sql`insert into collection_sync_mutation(family_id,actor_user_id,mutation_id,collection_id,payload_hash,result_json) values(${context.familyId},${context.userId},${command.mutationId},${id},${hash},${JSON.stringify(result)})`,
      );
      return result;
    },
    { behavior: "immediate" },
  );
}
