import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  bookProject,
  bookChapter,
  bookBlock,
  bookSourceRef,
  bookBlockSource,
  bookRevision,
} from "@/db/schema/book";
import type { FamilyContext } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import type {
  BookAudience,
  BookDetail,
  BookEdit,
  BookPage,
  BookSourceRef,
  BookTemplate,
} from "@/mobile/src/books/types";
import { BOOK_TEMPLATES } from "@/mobile/src/books/types";
import { BookError, validateBookEdit } from "./validation";
import {
  bookSourceTarget,
  createBookSourceResolver,
  SOURCE_FIELDS,
} from "./sources";
export { BookError } from "./validation";
export function assertBookContext(context: FamilyContext, write = false) {
  if (
    !hasFamilyCapability(context.role, write ? "event:write" : "archive:view")
  )
    throw new BookError("forbidden", 403);
  const live = getDb().get(
    sql`select u.id from user u join family f on f.id=u.family_id left join person p on p.id=u.person_id and p.family_id=u.family_id where u.id=${context.userId} and u.family_id=${context.familyId} and u.disabled_at is null and u.role=${context.role} and u.person_id is ${context.personId} and coalesce(p.is_guardian,0)=${Number(context.isGuardian)} and f.timezone=${context.familyTimezone} and f.child_later_unlock_age=${context.childLaterUnlockAge}`,
  );
  if (!live) throw new BookError("forbidden", 403);
}
function project(context: FamilyContext, id: string) {
  const row = getDb()
    .select()
    .from(bookProject)
    .where(
      and(eq(bookProject.id, id), eq(bookProject.familyId, context.familyId)),
    )
    .get();
  if (
    !row ||
    (row.audience === "personal" &&
      (!context.personId || row.ownerPersonId !== context.personId))
  )
    throw new BookError("not_found", 404);
  return row;
}
/** Internal persisted graph. Callers must authorize before exposing any content. */
function persistedEdit(id: string): BookEdit {
  const db = getDb(),
    row = db.select().from(bookProject).where(eq(bookProject.id, id)).get()!;
  const chapters = db
    .select()
    .from(bookChapter)
    .where(eq(bookChapter.projectId, id))
    .orderBy(asc(bookChapter.position))
    .all();
  const blocks = db
    .select()
    .from(bookBlock)
    .where(eq(bookBlock.projectId, id))
    .orderBy(asc(bookBlock.position))
    .all();
  const relations = db
    .select()
    .from(bookBlockSource)
    .where(eq(bookBlockSource.projectId, id))
    .orderBy(asc(bookBlockSource.position))
    .all();
  const sources = db
    .select()
    .from(bookSourceRef)
    .where(eq(bookSourceRef.projectId, id))
    .all();
  return {
    title: row.title,
    subtitle: row.subtitle,
    template: row.template,
    audience: row.audience,
    pageSize: row.pageSize,
    startDate: row.startDate,
    endDate: row.endDate,
    coverAssetId: row.coverAssetId,
    chapters: chapters.map((c) => ({ id: c.id, title: c.title })),
    blocks: blocks.map((b) => ({
      id: b.id,
      chapterId: b.chapterId,
      kind: b.kind,
      text: b.text,
      caption: b.caption,
      layout: JSON.parse(b.layoutJson),
      sourceIds: relations
        .filter((r) => r.blockId === b.id)
        .map((r) => r.sourceRefId),
    })),
    sources: sources.map((s) => ({
      id: s.id,
      kind: s.kind,
      memoryEventId: s.memoryEventId,
      assetId: s.assetId,
      contributionId: s.contributionId,
      storyId: s.storyId,
      collectionId: s.collectionId,
      fingerprint: s.fingerprint,
      label: s.label,
    })),
  };
}
function readerDetail(
  context: FamilyContext,
  row: typeof bookProject.$inferSelect,
  edit: BookEdit,
): BookDetail {
  const resolver = createBookSourceResolver(context, edit.audience),
    sourceStates: BookDetail["sourceStates"] = {},
    warnings: BookDetail["warnings"] = [],
    blockedBlockIds: string[] = [];
  for (const source of edit.sources) {
    const resolved = resolver(source.kind, bookSourceTarget(source));
    sourceStates[source.id] = {
      ...resolved.state,
      changed:
        resolved.state.available && resolved.fingerprint !== source.fingerprint,
    };
  }
  for (const chapter of edit.chapters)
    if (!edit.blocks.some((b) => b.chapterId === chapter.id))
      warnings.push({ blockId: null, code: "empty_chapter" });
  const blocks = edit.blocks.map((block) => {
    const states = block.sourceIds.map((id) => sourceStates[id]);
    if (states.some((s) => !s?.available)) {
      warnings.push({ blockId: block.id, code: "missing_source" });
      blockedBlockIds.push(block.id);
      return { ...block, text: "", caption: "" };
    }
    if (states.some((s) => s?.changed))
      warnings.push({ blockId: block.id, code: "source_changed" });
    const images = states.flatMap((s) =>
      s?.asset?.type === "image" ? [s.asset] : [],
    );
    if (images.some((a) => (a.width ?? 0) < 1200 || (a.height ?? 0) < 800))
      warnings.push({ blockId: block.id, code: "low_resolution" });
    if (block.text.length > 1600)
      warnings.push({ blockId: block.id, code: "long_text" });
    if (!block.text.trim() && !images.length && block.kind !== "date")
      warnings.push({ blockId: block.id, code: "empty_block" });
    return block;
  });
  const versions = getDb()
    .select({
      revision: bookRevision.revision,
      createdAt: bookRevision.createdAt,
    })
    .from(bookRevision)
    .where(eq(bookRevision.projectId, row.id))
    .orderBy(desc(bookRevision.revision))
    .all();
  return {
    ...edit,
    blocks,
    sources: edit.sources.map((s) =>
      sourceStates[s.id]?.available
        ? s
        : { ...s, label: "来源当前不可见", fingerprint: "" },
    ),
    id: row.id,
    revision: row.revision,
    ownerPersonId: row.ownerPersonId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    canWrite: hasFamilyCapability(context.role, "event:write"),
    timezone: context.familyTimezone,
    sourceStates,
    blockedBlockIds,
    warnings,
    versions: versions.map((v) => ({
      revision: v.revision,
      createdAt: v.createdAt.toISOString(),
    })),
  };
}
export function getBookProject(context: FamilyContext, id: string): BookDetail {
  return getDb().transaction(() => {
    assertBookContext(context);
    const row = project(context, id);
    return readerDetail(context, row, persistedEdit(id));
  });
}
export function listBookProjects(
  context: FamilyContext,
  options: { cursor?: string | null; deleted?: boolean } = {},
): BookPage {
  assertBookContext(context);
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
      throw new BookError("invalid_cursor");
    }
  }
  const rows = getDb()
    .select()
    .from(bookProject)
    .where(
      and(
        eq(bookProject.familyId, context.familyId),
        sql`(${bookProject.audience}='family' or (${bookProject.ownerPersonId}=${context.personId} and ${bookProject.audience}='personal'))`,
        options.deleted
          ? sql`${bookProject.deletedAt} is not null`
          : isNull(bookProject.deletedAt),
        cursor
          ? sql`(${bookProject.updatedAt},${bookProject.id})<(${cursor.at},${cursor.id})`
          : undefined,
      ),
    )
    .orderBy(desc(bookProject.updatedAt), desc(bookProject.id))
    .limit(31)
    .all();
  const entries = rows.slice(0, 30),
    last = entries.at(-1);
  return {
    entries: entries.map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      template: r.template,
      audience: r.audience,
      revision: r.revision,
      updatedAt: r.updatedAt.toISOString(),
      status: r.status,
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
export function createBookProject(
  context: FamilyContext,
  title: string,
  template: BookTemplate,
  audience: BookAudience = "family",
  draftKey: string | null = null,
) {
  const edit = validateBookEdit({
    title,
    subtitle: "",
    template,
    audience,
    pageSize: "A5",
    startDate: null,
    endDate: null,
    coverAssetId: null,
    chapters: [
      {
        id: randomUUID(),
        title: BOOK_TEMPLATES.find((t) => t.id === template)?.title || "章节",
      },
    ],
    blocks: [],
    sources: [],
  });
  return getDb().transaction((tx) => {
    assertBookContext(context, true);
    if (audience === "personal" && !context.personId)
      throw new BookError("person_required");
    const id = randomUUID();
    tx.insert(bookProject)
      .values({
        id,
        familyId: context.familyId,
        ownerPersonId: context.personId,
        title: edit.title,
        template,
        audience,
        draftKey,
      })
      .run();
    tx.insert(bookChapter)
      .values({
        id: edit.chapters[0]!.id,
        familyId: context.familyId,
        projectId: id,
        title: edit.chapters[0]!.title,
        position: 0,
      })
      .run();
    tx.insert(bookRevision)
      .values({
        id: randomUUID(),
        familyId: context.familyId,
        projectId: id,
        revision: 1,
        snapshotJson: JSON.stringify(edit),
      })
      .run();
    return id;
  });
}
export function saveBookProject(
  context: FamilyContext,
  id: string,
  revision: number,
  input: unknown,
): BookDetail {
  const incoming = validateBookEdit(input);
  getDb().transaction((tx) => {
    assertBookContext(context, true);
    const row = project(context, id);
    if (row.deletedAt) throw new BookError("book_deleted", 409);
    if (row.revision !== revision)
      throw new BookError("revision_conflict", 409);
    if (incoming.audience !== row.audience)
      throw new BookError("audience_locked");
    const previous = persistedEdit(id),
      current = readerDetail(context, row, previous),
      resolver = createBookSourceResolver(context, row.audience);
    const previousSources = new Map(previous.sources.map((s) => [s.id, s]));
    const sources: BookSourceRef[] = incoming.sources.map((s) => {
      const old = previousSources.get(s.id);
      if (old) {
        if (
          old.kind !== s.kind ||
          bookSourceTarget(old) !== bookSourceTarget(s)
        )
          throw new BookError("source_identity_changed");
        return old;
      }
      const state = resolver(s.kind, bookSourceTarget(s));
      if (!state.state.available)
        throw new BookError("source_unavailable", 403);
      return { ...s, fingerprint: state.fingerprint, label: state.state.label };
    });
    const allSources = [
      ...previous.sources,
      ...sources.filter((s) => !previousSources.has(s.id)),
    ];
    if (allSources.length > 2000) throw new BookError("book_too_large");
    const blocks = incoming.blocks.map((b) => {
      if (current.blockedBlockIds.includes(b.id)) {
        const old = previous.blocks.find((p) => p.id === b.id)!;
        if (JSON.stringify(b.sourceIds) !== JSON.stringify(old.sourceIds))
          throw new BookError("blocked_block_locked");
        return { ...b, text: old.text, caption: old.caption };
      }
      if (
        b.sourceIds.some((sourceId) => {
          const s = allSources.find((ref) => ref.id === sourceId);
          return !s || !resolver(s.kind, bookSourceTarget(s)).state.available;
        })
      )
        throw new BookError("source_unavailable", 403);
      return b;
    });
    if (
      incoming.coverAssetId &&
      incoming.coverAssetId !== row.coverAssetId &&
      (!allSources.some(
        (s) => s.kind === "asset" && s.assetId === incoming.coverAssetId,
      ) ||
        !resolver("asset", incoming.coverAssetId).state.available ||
        resolver("asset", incoming.coverAssetId).state.asset?.type !== "image")
    )
      throw new BookError("invalid_cover");
    tx.update(bookProject)
      .set({
        title: incoming.title,
        subtitle: incoming.subtitle,
        template: incoming.template,
        pageSize: incoming.pageSize,
        startDate: incoming.startDate,
        endDate: incoming.endDate,
        coverAssetId: incoming.coverAssetId,
        revision: revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(bookProject.id, id))
      .run();
    // Snapshot SourceRefs stay durable even when a current block or chapter is removed.
    tx.delete(bookBlockSource).where(eq(bookBlockSource.projectId, id)).run();
    tx.delete(bookBlock).where(eq(bookBlock.projectId, id)).run();
    tx.delete(bookChapter).where(eq(bookChapter.projectId, id)).run();
    const newSources = allSources.filter((s) => !previousSources.has(s.id));
    if (newSources.length)
      tx.insert(bookSourceRef)
        .values(
          newSources.map((s) => ({
            ...s,
            familyId: context.familyId,
            projectId: id,
          })),
        )
        .run();
    if (incoming.chapters.length)
      tx.insert(bookChapter)
        .values(
          incoming.chapters.map((chapter, position) => ({
            ...chapter,
            position,
            familyId: context.familyId,
            projectId: id,
          })),
        )
        .run();
    if (blocks.length)
      tx.insert(bookBlock)
        .values(
          blocks.map((b, position) => ({
            id: b.id,
            chapterId: b.chapterId,
            kind: b.kind,
            text: b.text,
            caption: b.caption,
            layoutJson: JSON.stringify(b.layout),
            position,
            familyId: context.familyId,
            projectId: id,
          })),
        )
        .run();
    const relations = blocks.flatMap((b) =>
      b.sourceIds.map((sourceRefId, position) => ({
        id: randomUUID(),
        familyId: context.familyId,
        projectId: id,
        blockId: b.id,
        sourceRefId,
        position,
      })),
    );
    if (relations.length) tx.insert(bookBlockSource).values(relations).run();
  });
  return getBookProject(context, id);
}
export function saveBookVersion(
  context: FamilyContext,
  id: string,
  revision: number,
) {
  getDb().transaction((tx) => {
    assertBookContext(context, true);
    const row = project(context, id);
    if (row.deletedAt) throw new BookError("book_deleted", 409);
    if (row.revision !== revision)
      throw new BookError("revision_conflict", 409);
    if (
      !tx
        .select()
        .from(bookRevision)
        .where(
          and(
            eq(bookRevision.projectId, id),
            eq(bookRevision.revision, revision),
          ),
        )
        .get()
    )
      tx.insert(bookRevision)
        .values({
          id: randomUUID(),
          familyId: context.familyId,
          projectId: id,
          revision,
          snapshotJson: JSON.stringify(persistedEdit(id)),
        })
        .run();
  });
  return getBookProject(context, id);
}
export function setBookDeleted(
  context: FamilyContext,
  id: string,
  revision: number,
  deleted: boolean,
) {
  getDb().transaction((tx) => {
    assertBookContext(context, true);
    const row = project(context, id);
    if (row.revision !== revision)
      throw new BookError("revision_conflict", 409);
    tx.update(bookProject)
      .set({
        deletedAt: deleted ? new Date() : null,
        revision: revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(bookProject.id, id))
      .run();
  });
  return getBookProject(context, id);
}
/** Revision reading also re-evaluates every source under the current reader policy. */
export function getBookVersion(
  context: FamilyContext,
  id: string,
  revision: number,
) {
  return getDb().transaction(() => {
    assertBookContext(context);
    const row = project(context, id);
    if (row.deletedAt) throw new BookError("book_deleted", 404);
    const saved = getDb()
      .select()
      .from(bookRevision)
      .where(
        and(
          eq(bookRevision.projectId, id),
          eq(bookRevision.revision, revision),
        ),
      )
      .get();
    if (!saved) throw new BookError("version_not_found", 404);
    const edit = validateBookEdit(JSON.parse(saved.snapshotJson));
    const refs = getDb()
      .select()
      .from(bookSourceRef)
      .where(eq(bookSourceRef.projectId, id))
      .all();
    edit.sources = edit.sources.map((source) => {
      const canonical = refs.find((r) => r.id === source.id);
      if (!canonical || canonical.kind !== source.kind)
        throw new BookError("invalid_source_graph", 500);
      return {
        ...source,
        [SOURCE_FIELDS[source.kind]]: canonical[SOURCE_FIELDS[source.kind]],
      };
    });
    return readerDetail(context, { ...row, revision }, edit);
  });
}
export function newBookSource(
  kind: BookSourceRef["kind"],
  targetId: string,
): BookSourceRef {
  return {
    id: randomUUID(),
    kind,
    memoryEventId: null,
    assetId: null,
    contributionId: null,
    storyId: null,
    collectionId: null,
    [SOURCE_FIELDS[kind]]: targetId,
    fingerprint: "",
    label: "",
  };
}

/** Export captures an immutable revision without changing any user's editing. */
export function ensureBookRenderVersion(context:FamilyContext,id:string,revision:number){
 return getDb().transaction(tx=>{
  assertBookContext(context);const row=project(context,id);
  if(row.deletedAt)throw new BookError('book_deleted',404);
  const existing=tx.select().from(bookRevision).where(and(eq(bookRevision.projectId,id),eq(bookRevision.revision,revision))).get();
  if(!existing){if(row.revision!==revision)throw new BookError('revision_conflict',409);tx.insert(bookRevision).values({id:randomUUID(),familyId:context.familyId,projectId:id,revision,snapshotJson:JSON.stringify(persistedEdit(id))}).run();}
  return getBookVersion(context,id,revision);
 });
}
