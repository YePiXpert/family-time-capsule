import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { contribution } from "@/db/schema/contribution";
import { storyParagraph } from "@/db/schema/story";
import { getCollection } from "@/lib/collections/service";
import type { FamilyContext } from "@/lib/family/context";
import type { BookBlock, BookSourceKind } from "@/mobile/src/books/types";
import { defaultBookLayout } from "@/mobile/src/books/types";
import {
  BookError,
  getBookProject,
  newBookSource,
  saveBookProject,
} from "./service";
import { bookSourceTarget, createBookSourceResolver } from "./sources";
export function addBookSelections(
  context: FamilyContext,
  projectId: string,
  revision: number,
  selection: unknown,
  chapterId?: string,
) {
  if (
    !Array.isArray(selection) ||
    !selection.length ||
    selection.length > 100 ||
    selection.some(
      (s) =>
        !s ||
        !["memory", "collection", "story", "contribution"].includes(s.kind) ||
        typeof s.id !== "string" ||
        s.id.length > 128,
    )
  )
    throw new BookError("invalid_selection");
  return getDb().transaction(() => {
    const doc = getBookProject(context, projectId);
    if (doc.revision !== revision)
      throw new BookError("revision_conflict", 409);
    const resolve = createBookSourceResolver(context, doc.audience);
    if (chapterId && !doc.chapters.some((c) => c.id === chapterId))
      throw new BookError("invalid_chapter");
    if (!doc.chapters.length)
      doc.chapters.push({ id: randomUUID(), title: "新章节" });
    const fallbackChapter = chapterId || doc.chapters.at(-1)!.id;
    function ref(kind: BookSourceKind, id: string) {
      const old = doc.sources.find(
        (s) => s.kind === kind && bookSourceTarget(s) === id,
      );
      if (old) return old.id;
      const source = newBookSource(kind, id);
      doc.sources.push(source);
      return source.id;
    }
    function block(
      chapter: string,
      kind: BookBlock["kind"],
      text: string,
      sourceIds: string[],
      caption = "",
      breakBefore = false,
    ) {
      doc.blocks.push({
        id: randomUUID(),
        chapterId: chapter,
        kind,
        text,
        caption,
        sourceIds,
        layout: { ...defaultBookLayout(), breakBefore },
      });
    }
    function already(kind: BookSourceKind, id: string) {
      const source = doc.sources.find(
        (s) => s.kind === kind && bookSourceTarget(s) === id,
      );
      return source && doc.blocks.some((b) => b.sourceIds.includes(source.id));
    }
    function addContribution(id: string, chapter: string, parents: string[]) {
      const material = resolve("contribution", id);
      if (!material.state.available) return;
      if (already("contribution", id)) return;
      block(
        chapter,
        "quote",
        material.text,
        [ref("contribution", id), ...parents],
        "",
        true,
      );
    }
    function memory(id: string, chapter: string, parents: string[]) {
      if (already("memory", id)) return;
      const material = resolve("memory", id);
      if (!material.state.available)
        throw new BookError("source_unavailable", 403);
      const sourceId = ref("memory", id),
        base = [sourceId, ...parents];
      if (doc.template === "letters") {
        const narrations = getDb()
          .select({ id: contribution.id })
          .from(contribution)
          .where(
            and(
              eq(contribution.memoryEventId, id),
              isNull(contribution.deletedAt),
            ),
          )
          .orderBy(contribution.createdAt, contribution.id)
          .all();
        for (const narration of narrations)
          addContribution(narration.id, chapter, base);
        if (!narrations.length && material.text.trim())
          block(chapter, "quote", material.text, base, "当时写下的", true);
      } else if (doc.template === "photos") {
        const images = material.images.filter(
          (image) => resolve("asset", image).state.available,
        );
        for (let i = 0; i < images.length; i += 4) {
          const group = images.slice(i, i + 4);
          block(
            chapter,
            group.length === 1
              ? "image"
              : group.length === 2
                ? "double"
                : "collage",
            "",
            [...base, ...group.map((image) => ref("asset", image))],
            material.state.label,
            true,
          );
        }
        if (!images.length)
          block(
            chapter,
            "text",
            material.text || material.state.label,
            base,
            "",
            true,
          );
      } else {
        block(chapter, "date", "", base, "", true);
        block(
          chapter,
          "text",
          [material.state.label, material.text].filter(Boolean).join("\n\n"),
          base,
        );
        const image = material.images.find(
          (image) => resolve("asset", image).state.available,
        );
        if (image)
          block(
            chapter,
            "image",
            "",
            [...base, ref("asset", image)],
            material.state.label,
          );
      }
    }
    for (const selected of selection as {
      kind: "memory" | "collection" | "story" | "contribution";
      id: string;
    }[]) {
      const state = resolve(selected.kind, selected.id);
      if (!state.state.available)
        throw new BookError("source_unavailable", 403);
      if (selected.kind === "memory") memory(selected.id, fallbackChapter, []);
      else if (selected.kind === "contribution")
        addContribution(selected.id, fallbackChapter, []);
      else if (selected.kind === "collection") {
        const album = getCollection(context, selected.id),
          parent = ref("collection", selected.id);
        const sections = [{ id: null, title: album.title }, ...album.sections];
        for (const section of sections) {
          let items = album.items.filter(
            (item) =>
              item.sectionId === section.id &&
              item.source &&
              item.memoryEventId,
          );
          if (album.sortMode === "time")
            items = [...items].sort(
              (a, b) =>
                a.source!.occurredAt.localeCompare(b.source!.occurredAt) ||
                a.id.localeCompare(b.id),
            );
          if (!items.length) continue;
          const chapter = randomUUID();
          doc.chapters.push({ id: chapter, title: section.title });
          for (const item of items) {
            const before = doc.blocks.length;
            memory(item.memoryEventId!, chapter, [parent]);
            if (item.caption && doc.blocks[before])
              doc.blocks[before]!.caption = item.caption;
          }
        }
      } else {
        if (already("story", selected.id)) continue;
        const sourceId = ref("story", selected.id),
          chapter = chapterId || randomUUID();
        if (!chapterId) doc.chapters.push({ id: chapter, title: state.state.label });
        const paragraphs = getDb()
          .select()
          .from(storyParagraph)
          .where(
            and(
              eq(storyParagraph.storyId, selected.id),
              eq(storyParagraph.familyId, context.familyId),
            ),
          )
          .orderBy(storyParagraph.position)
          .all();
        paragraphs.forEach((p, i) =>
          block(
            chapter,
            p.kind === "quote" ? "quote" : "text",
            p.text,
            [sourceId],
            "",
            i === 0,
          ),
        );
      }
    }
    return saveBookProject(context, projectId, revision, doc);
  });
}
