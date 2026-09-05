import { count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  collection,
  collectionSection,
  collectionItem,
} from "@/db/schema/collection";
import { validateCollectionArchive } from "./portable.mjs";
import type { ContributionAccessTransaction } from "@/lib/authz/contribution-access";

export function collectCollectionArchive(familyId: string) {
  const db = getDb();
  return {
    collections: db
      .select()
      .from(collection)
      .where(eq(collection.familyId, familyId))
      .all()
      .map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: row.deletedAt?.toISOString() ?? null,
      })),
    sections: db
      .select()
      .from(collectionSection)
      .where(eq(collectionSection.familyId, familyId))
      .all(),
    items: db
      .select()
      .from(collectionItem)
      .where(eq(collectionItem.familyId, familyId))
      .all(),
  };
}
export type CollectionArchiveGraph = ReturnType<
  typeof collectCollectionArchive
>;
export function parseCollectionArchive(
  collections: unknown,
  sections: unknown,
  items: unknown,
  familyId: string,
  eventIds: Set<string>,
  assetIds: Set<string>,
): CollectionArchiveGraph {
  return validateCollectionArchive(
    collections,
    sections,
    items,
    familyId,
    eventIds,
    assetIds,
  ) as CollectionArchiveGraph;
}
export function restoreCollectionArchive(
  tx: ContributionAccessTransaction,
  graph: CollectionArchiveGraph,
  familyId: string,
) {
  if (graph.collections.length)
    tx.insert(collection)
      .values(
        graph.collections.map((row) => ({
          ...row,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
          deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
        })),
      )
      .run();
  if (graph.sections.length)
    tx.insert(collectionSection).values(graph.sections).run();
  if (graph.items.length) tx.insert(collectionItem).values(graph.items).run();
  for (const [table, rows] of [
    [collection, graph.collections],
    [collectionSection, graph.sections],
    [collectionItem, graph.items],
  ] as const) {
    const actual = tx
      .select({ n: count() })
      .from(table)
      .where(eq(table.familyId, familyId))
      .get()!.n;
    if (actual !== rows.length)
      throw new Error("collection_post_verify_failed");
  }
}
