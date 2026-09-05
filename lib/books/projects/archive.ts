import { count, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  bookProject,
  bookChapter,
  bookBlock,
  bookSourceRef,
  bookBlockSource,
  bookRevision,
} from "@/db/schema/book";
import type { ContributionAccessTransaction } from "@/lib/authz/contribution-access";
import { validateBookArchive } from "./portable.mjs";
const iso = (d: Date | null) => d?.toISOString() ?? null;
export function collectBookArchive(familyId: string) {
  const db = getDb();
  return {
    projects: db
      .select()
      .from(bookProject)
      .where(eq(bookProject.familyId, familyId))
      .all()
      .map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        deletedAt: iso(p.deletedAt),
      })),
    chapters: db
      .select()
      .from(bookChapter)
      .where(eq(bookChapter.familyId, familyId))
      .all(),
    blocks: db
      .select()
      .from(bookBlock)
      .where(eq(bookBlock.familyId, familyId))
      .all(),
    sources: db
      .select()
      .from(bookSourceRef)
      .where(eq(bookSourceRef.familyId, familyId))
      .all()
      .map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
    links: db
      .select()
      .from(bookBlockSource)
      .where(eq(bookBlockSource.familyId, familyId))
      .all(),
    revisions: db
      .select()
      .from(bookRevision)
      .where(eq(bookRevision.familyId, familyId))
      .all()
      .map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  };
}
export type BookArchiveGraph = ReturnType<typeof collectBookArchive>;
export type BookArchiveReferences = Record<
  "memory" | "asset" | "contribution" | "story" | "collection" | "person",
  Set<string>
>;
export function parseBookArchive(
  raw: unknown[],
  familyId: string,
  refs: BookArchiveReferences,
): BookArchiveGraph {
  return validateBookArchive(raw, familyId, refs) as BookArchiveGraph;
}
export function restoreBookArchive(
  tx: ContributionAccessTransaction,
  g: BookArchiveGraph,
  familyId: string,
) {
  if (g.projects.length)
    tx.insert(bookProject)
      .values(
        g.projects.map((p) => ({
          ...p,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
          deletedAt: p.deletedAt ? new Date(p.deletedAt) : null,
        })),
      )
      .run();
  if (g.chapters.length) tx.insert(bookChapter).values(g.chapters).run();
  if (g.blocks.length) tx.insert(bookBlock).values(g.blocks).run();
  if (g.sources.length)
    tx.insert(bookSourceRef)
      .values(
        g.sources.map((s) => ({ ...s, createdAt: new Date(s.createdAt) })),
      )
      .run();
  if (g.links.length) tx.insert(bookBlockSource).values(g.links).run();
  if (g.revisions.length)
    tx.insert(bookRevision)
      .values(
        g.revisions.map((r) => ({ ...r, createdAt: new Date(r.createdAt) })),
      )
      .run();
  for (const [table, rows] of [
    [bookProject, g.projects],
    [bookChapter, g.chapters],
    [bookBlock, g.blocks],
    [bookSourceRef, g.sources],
    [bookBlockSource, g.links],
    [bookRevision, g.revisions],
  ] as const) {
    if (
      tx
        .select({ n: count() })
        .from(table)
        .where(eq(table.familyId, familyId))
        .get()!.n !== rows.length
    )
      throw new Error("book_post_verify_failed");
  }
}

/** Only retain deleted rows that close the durable book source graph. */
export function collectBookSourceClosure(familyId: string) {
  const db=getDb(),graph=collectBookArchive(familyId),events=new Set<string>(),contributions=new Set<string>(),stories=new Set<string>();
  for(const s of graph.sources){if(s.memoryEventId)events.add(s.memoryEventId);if(s.contributionId)contributions.add(s.contributionId);if(s.storyId)stories.add(s.storyId);}
  for(const storyId of stories){
    const sources=db.all<{kind:string;sourceId:string|null}>(sql`select s.source_type kind,s.source_id sourceId from story_source s join story_paragraph p on p.id=s.paragraph_id where p.story_id=${storyId} and p.family_id=${familyId} and s.family_id=${familyId}`);
    for(const source of sources){if(!source.sourceId)continue;
      if(source.kind==='memory_event')events.add(source.sourceId);
      if(source.kind==='contribution')contributions.add(source.sourceId);
      if(source.kind==='fact'){
        const f=db.get<{eventId:string}>(sql`select f.memory_event_id eventId from fact f join memory_event e on e.id=f.memory_event_id where f.id=${source.sourceId} and e.family_id=${familyId}`);if(f)events.add(f.eventId);
        for(const ref of db.all<{id:string}>(sql`select source_id id from fact_source where fact_id=${source.sourceId} and family_id=${familyId} and source_type='contribution' and source_id is not null`))contributions.add(ref.id);
      }
    }
  }
  for(const id of contributions){const c=db.get<{eventId:string}>(sql`select c.memory_event_id eventId from contribution c join memory_event e on e.id=c.memory_event_id where c.id=${id} and e.family_id=${familyId}`);if(c)events.add(c.eventId);}
  return {events:[...events],contributions:[...contributions],stories:[...stories]};
}
