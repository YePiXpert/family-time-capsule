import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { asset } from "@/db/schema/asset";
import { assetTranscript } from "@/db/schema/transcript";
import type { FamilyContext } from "@/lib/family/context";
import {
  assertBookContext,
  BookError,
  getBookProject,
} from "@/lib/books/projects/service";
import {
  createBookSourceResolver,
  sourceFingerprint,
} from "@/lib/books/projects/sources";
import { collectBookReadingMedia } from "@/lib/books/projects/media";
import { getCollection } from "@/lib/collections/service";
import { defaultBookLayout } from "@/mobile/src/books/types";
import { parseReaderSegments } from "@/mobile/src/media/types";
import {
  READING_LIMITS,
  type ReadingBlock,
  type ReadingKind,
  type ReadingManifest,
  type ReadingMedia,
} from "@/mobile/src/reading/types";
export function getReadingIdentity(context: FamilyContext) {
  assertBookContext(context);
  return { userId: context.userId, familyId: context.familyId };
}
export function getReadingManifest(
  context: FamilyContext,
  kind: ReadingKind,
  id: string,
): ReadingManifest {
  return getDb().transaction(() => {
    assertBookContext(context);
    if (!["book", "collection"].includes(kind))
      throw new BookError("not_found", 404);
    const book = kind === "book" ? getBookProject(context, id) : null,
      album = kind === "collection" ? getCollection(context, id) : null;
    if (book?.deletedAt || album?.deletedAt)
      throw new BookError("not_found", 404);
    if (book?.blockedBlockIds.length)
      throw new BookError("source_unavailable", 409);
    const audience = book?.audience ?? "personal",
      resolve = createBookSourceResolver(context, audience),
      media = new Map<string, ReadingMedia>();
    const date = (at: string | null | undefined) =>
      at
        ? new Intl.DateTimeFormat("zh-CN", {
            timeZone: context.familyTimezone,
            dateStyle: "long",
          }).format(new Date(at))
        : "时间未知";
    function addMedia(id: string) {
      if (media.has(id)) return true;
      const source = resolve("asset", id);
      if (!source.state.available) return false;
      const a = getDb()
        .select()
        .from(asset)
        .where(and(eq(asset.familyId, context.familyId), eq(asset.id, id)))
        .get();
      if (!a) return false;
      const candidates = getDb().all<{ id: string }>(
          sql`select c.id from contribution c join memory_event e on e.id=c.memory_event_id where e.family_id=${context.familyId} and c.audio_asset_id=${id} and c.deleted_at is null order by c.created_at,c.id`,
        ),
        voices = candidates
          .map((c) => resolve("contribution", c.id))
          .filter((s) => s.state.available);
      const transcript =
        a.type === "audio"
          ? getDb()
              .select()
              .from(assetTranscript)
              .where(
                and(
                  eq(assetTranscript.familyId, context.familyId),
                  eq(assetTranscript.assetId, id),
                ),
              )
              .get()
          : null;
      media.set(id, {
        id,
        filename: a.originalFilename,
        type: a.type,
        mimeType: a.mimeType,
        bytes: a.bytes,
        sha256: a.sha256,
        width: a.width,
        height: a.height,
        durationMs: a.durationMs,
        author:
          [...new Set(voices.map((v) => v.state.author).filter(Boolean))].join(
            "、",
          ) || null,
        dateLabel: voices[0]?.state.authoredAt
          ? `讲述于 ${date(voices[0].state.authoredAt)}`
          : `记忆日期 ${date(source.state.occurredAt)}`,
        memoryEventId: source.eventId,
        transcript: transcript
          ? {
              text: transcript.editedTranscript ?? transcript.rawTranscript,
              edited: Boolean(transcript.editedTranscript),
              segments:
                transcript.editedTranscript !== null
                  ? []
                  : parseReaderSegments(transcript.segmentsJson),
            }
          : null,
      });
      if (media.size > READING_LIMITS.files)
        throw new BookError("reading_too_large");
      return true;
    }
    let chapters: ReadingManifest["chapters"];
    if (book) {
      chapters = book.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        blocks: book.blocks
          .filter((b) => b.chapterId === chapter.id)
          .map((b) => {
            const states = b.sourceIds
                .map((id) => book.sourceStates[id])
                .filter(Boolean),
              images = ["image", "double", "collage"].includes(b.kind)
                ? states.flatMap((s) =>
                    s.asset?.type === "image" && addMedia(s.asset.id)
                      ? [s.asset.id]
                      : [],
                  )
                : [];
            return {
              id: b.id,
              kind: b.kind,
              text: b.text,
              caption: b.caption,
              images: images.slice(
                0,
                b.kind === "double" ? 2 : b.kind === "collage" ? 4 : 1,
              ),
              layout: b.layout,
              sourceLabels: [...new Set(states.map((s) => s.label))],
              dateLabel: [
                ...new Set(
                  states
                    .map((s) =>
                      s.occurredAt
                        ? `${date(s.occurredAt)}${s.ageLabel ? ` · ${s.ageLabel}` : ""}`
                        : "",
                    )
                    .filter(Boolean),
                ),
              ].join(" / "),
              author: states.map((s) => s.author).find(Boolean) ?? null,
              memoryEventId:
                book.sources.find(
                  (s) => b.sourceIds.includes(s.id) && s.kind === "memory",
                )?.memoryEventId ?? null,
            };
          }),
      }));
      if (book.coverAssetId && addMedia(book.coverAssetId))
        chapters.unshift({
          id: "cover",
          title: "封面",
          blocks: [
            {
              id: "cover",
              kind: "image",
              text: book.subtitle,
              caption: "",
              images: [book.coverAssetId],
              layout: defaultBookLayout(),
              sourceLabels: [],
              dateLabel: [book.startDate, book.endDate]
                .filter(Boolean)
                .join(" — "),
              author: null,
              memoryEventId: null,
            },
          ],
        });
      collectBookReadingMedia(context, book).forEach((m) =>
        addMedia(m.asset.id),
      );
    } else {
      const sections = [
        { id: "main", title: album!.title },
        ...album!.sections,
      ];
      chapters = sections.map((section) => {
        const items = album!.items.filter(
          (i) => (i.sectionId ?? "main") === section.id,
        );
        if (album!.sortMode === "time")
          items.sort(
            (a, b) =>
              (a.source?.occurredAt ?? "").localeCompare(
                b.source?.occurredAt ?? "",
              ) || a.id.localeCompare(b.id),
          );
        const blocks: ReadingBlock[] = items.flatMap((item) => {
          const source = resolve("memory", item.memoryEventId);
          if (!source.state.available) return [];
          const assets = getDb().all<{
            id: string;
          }>(sql`select asset_id id from memory_event_asset where family_id=${context.familyId} and memory_event_id=${item.memoryEventId}
       union select c.audio_asset_id id from contribution c join memory_event e on e.id=c.memory_event_id where e.family_id=${context.familyId} and e.id=${item.memoryEventId} and c.audio_asset_id is not null and c.deleted_at is null`);
          assets.forEach((a) => addMedia(a.id));
          const images = assets
            .filter((a) => media.get(a.id)?.type === "image")
            .map((a) => a.id);
          return [
            {
              id: item.id,
              kind: "text",
              text: source.text,
              caption: item.caption,
              images,
              layout: defaultBookLayout(),
              sourceLabels: [source.state.label],
              dateLabel: `${date(source.state.occurredAt)}${source.state.ageLabel ? ` · ${source.state.ageLabel}` : ""}`,
              author: null,
              memoryEventId: item.memoryEventId,
            },
          ];
        });
        return { id: section.id, title: section.title, blocks };
      });
    }
    const manifest = {
      schemaVersion: 1 as const,
      kind,
      id,
      revision: book?.revision ?? album!.revision,
      userId: context.userId,
      familyId: context.familyId,
      audience,
      title: book?.title ?? album!.title,
      subtitle: book?.subtitle ?? album!.description,
      timezone: context.familyTimezone,
      chapters,
      media: [...media.values()].sort((a, b) => a.id.localeCompare(b.id)),
      bytes: 0,
      digest: "",
    };
    const metadataBytes = Buffer.byteLength(JSON.stringify(manifest));
    if (metadataBytes > READING_LIMITS.metadataBytes)
      throw new BookError("reading_too_large");
    manifest.bytes =
      metadataBytes + manifest.media.reduce((n, m) => n + m.bytes, 0);
    manifest.digest = sourceFingerprint(manifest);
    return manifest;
  });
}
