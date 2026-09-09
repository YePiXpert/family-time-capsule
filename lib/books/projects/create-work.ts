import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import type { FamilyContext } from "@/lib/family/context";
import { createCollection, getCollection, saveCollection } from "@/lib/collections/service";
import { BookError, createBookProject, getBookProject, saveBookProject, saveBookVersion } from "./service";
import { addBookSelections } from "./select";
import { createBookSourceResolver } from "./sources";

/** Selection is re-authorized inside the transaction; failure leaves no empty work. */
export function createWork(context: FamilyContext, input: Record<string, unknown>) {
  const kind = input.kind;
  const audience = input.audience ?? "family";
  const template = input.template ?? "growth";
  if (kind === "book" && template !== "growth" && template !== "photos") throw new BookError("invalid_template");
  if (kind !== "album" && kind !== "book") throw new BookError("invalid_work");
  if (audience !== "family" && audience !== "personal") throw new BookError("invalid_audience");
  if (!Array.isArray(input.selection) || !input.selection.length || input.selection.length > 100) throw new BookError("invalid_selection");
  const selection = input.selection.map((item: unknown) => {
    if (!item || typeof item !== "object" || !("kind" in item) || !("id" in item) || typeof item.id !== "string" || !item.id.length || item.id.length > 128 || (item.kind !== "memory" && (kind !== "book" || item.kind !== "collection"))) throw new BookError("invalid_selection");
    return { kind: item.kind as "memory" | "collection", id: item.id };
  });
  if (new Set(selection.map(s => `${s.kind}:${s.id}`)).size !== selection.length) throw new BookError("invalid_selection");
  return getDb().transaction(() => {
    const resolve = createBookSourceResolver(context, kind === "album" ? "personal" : audience);
    const sources = selection.map(s => resolve(s.kind, s.id));
    if (sources.some(s => !s.state.available)) throw new BookError("source_unavailable", 403);
    // Album names are visible to the family even when some source memories are private.
    const publicTitle = kind !== "album" || createBookSourceResolver(context, "family")(selection[0]!.kind, selection[0]!.id).state.available;
    const title = `${publicTitle ? sources[0]!.state.label || "家庭记忆" : "家庭记忆"} · ${kind === "album" ? "相册" : "家庭书"}`.slice(0, 200);
    if (kind === "album") {
      const id = createCollection(context, title, "album");
      const album = getCollection(context, id);
      saveCollection(context, id, album.revision, {
        ...album,
        items: selection.map(s => ({ id: randomUUID(), memoryEventId: s.id, assetId: null, sectionId: null, caption: "" })),
      });
      const populated = getCollection(context, id);
      const coverAssetId = populated.items.find(item => item.source?.coverAssetId)?.source?.coverAssetId ?? null;
      if (coverAssetId) saveCollection(context, id, populated.revision, { ...populated, coverAssetId });
      return { id, kind };
    }
    const id = createBookProject(context, title, template as "growth" | "photos", audience);
    let book = addBookSelections(context, id, getBookProject(context, id).revision, selection);
    const coverAssetId = Object.values(book.sourceStates).find(s => s.available && s.asset?.type === "image")?.asset?.id ?? null;
    if (coverAssetId) book = saveBookProject(context, id, book.revision, { ...book, coverAssetId });
    saveBookVersion(context, id, book.revision);
    return { id, kind };
  });
}
