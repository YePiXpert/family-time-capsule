import { randomUUID } from "expo-crypto";
import type { SQLiteDatabase } from "expo-sqlite";
import { getDatabase } from "../storage/database";
import { listLocalDrafts, type LocalDraft } from "../drafts/store";
import { savedDraftContent } from "../drafts/reading";

import type { MaterialRef, LocalAlbum } from "./local-types";
export type { MaterialRef, AlbumItem, LocalAlbum } from "./local-types";
export const materialKey = (ref: MaterialRef) =>
  JSON.stringify([ref.scope, ref.kind, ref.id]);
const decode = (row: { snapshot_json: string }) =>
  JSON.parse(row.snapshot_json) as LocalAlbum;
export async function listLocalAlbums(scope: string): Promise<LocalAlbum[]> {
  const db = await getDatabase();
  return (
    await db.getAllAsync<{ snapshot_json: string }>(
      "SELECT snapshot_json FROM local_album WHERE scope=? ORDER BY updated_at DESC,id DESC",
      scope,
    )
  ).map(decode);
}
export async function getLocalAlbum(
  scope: string,
  id: string,
): Promise<LocalAlbum | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ snapshot_json: string }>(
    "SELECT snapshot_json FROM local_album WHERE scope=? AND id=?",
    scope,
    id,
  );
  return row ? decode(row) : null;
}
export function newLocalAlbum(
  scope: string,
  title = "新相册",
  refs: MaterialRef[] = [],
): LocalAlbum {
  return {
    id: randomUUID(),
    scope,
    title,
    items: [
      ...new Map(refs.map((ref) => [materialKey(ref), ref])).values(),
    ].map((ref) => ({ id: randomUUID(), ref })),
    coverItemId: null,
    revision: 1,
    updatedAt: new Date().toISOString(),
    remoteId: null,
    remoteRevision: 0,
    consent: null,
    pending: null,
    error: "",
  };
}
export async function saveLocalAlbum(
  row: LocalAlbum,
  expectedRevision: number,
) {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync((tx) =>
    saveLocalAlbumInTransaction(tx, row, expectedRevision),
  );
}
export async function saveLocalAlbumInTransaction(
  tx: SQLiteDatabase,
  row: LocalAlbum,
  expectedRevision: number,
) {
  if (
    !row.title.trim() ||
    row.title.length > 200 ||
    row.items.length > 500 ||
    new Set(row.items.map((i) => materialKey(i.ref))).size !==
      row.items.length ||
    row.items.some(
      (i) =>
        i.ref.kind === "collection" ||
        (i.ref.scope !== row.scope &&
          !(
            i.ref.kind === "localDraft" &&
            (i.ref.scope === "local" || row.scope === "local")
          )),
    )
  )
    throw new Error("相册内容无效，原相册仍保留。");
  const current = await tx.getFirstAsync<{ revision: number }>(
    "SELECT revision FROM local_album WHERE scope=? AND id=?",
    row.scope,
    row.id,
  );
  if ((current?.revision ?? 0) !== expectedRevision)
    throw new Error("相册已在另一处修改，请重新打开。");
  await tx.runAsync(
    "INSERT INTO local_album(scope,id,snapshot_json,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET snapshot_json=excluded.snapshot_json,revision=excluded.revision,updated_at=excluded.updated_at",
    row.scope,
    row.id,
    JSON.stringify(row),
    row.revision,
    row.updatedAt,
  );
}
export function appendAlbumItems(
  album: LocalAlbum,
  refs: MaterialRef[],
): LocalAlbum {
  const seen = new Set(album.items.map((i) => materialKey(i.ref)));
  const added = refs
    .filter((ref) => {
      const key = materialKey(ref);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((ref) => ({ id: randomUUID(), ref }));
  return {
    ...album,
    items: [...album.items, ...added],
    revision: album.revision + 1,
    updatedAt: new Date().toISOString(),
    error: "",
    pending:
      album.pending ??
      (album.remoteId && added.length
        ? {
            mutationId: randomUUID(),
            itemIds: added.slice(0, 100).map((i) => i.id),
          }
        : null),
  };
}
export async function albumUploadAuthorized(
  scope: string,
  draftId: string,
): Promise<boolean> {
  return (await listLocalAlbums(scope)).some(
    (a) =>
      a.consent?.scope === scope &&
      a.consent.draftIds.includes(draftId) &&
      !!a.pending,
  );
}
export async function localMaterialDetails(
  ref: MaterialRef,
  known?: LocalDraft,
) {
  if (ref.kind !== "localDraft") return null;
  const draft =
    known?.id === ref.id && known.scope === ref.scope
      ? known
      : (await listLocalDrafts(ref.scope)).find((d) => d.id === ref.id);
  if (draft?.status === "published" && draft.memoryEventId)
    return {
      title: "",
      text: "",
      occurredAt: null,
      occurredAtPrecision: "unknown" as const,
      uri: null,
      visibility: draft.content.visibility,
      remoteMemoryId: draft.memoryEventId,
    };
  const content = draft ? savedDraftContent(draft) : null;
  if (!content) return null;
  const db = await getDatabase();
  const cover =
    content.items.find((i) => i.id === content.coverItemId) ?? content.items[0];
  const original = cover?.localCaptureRef
    ? await db.getFirstAsync<{
        local_uri: string | null;
        media_type: string | null;
      }>(
        "SELECT local_uri,media_type FROM local_capture WHERE id=?",
        cover.localCaptureRef,
      )
    : null;
  return {
    title: content.title || content.text.slice(0, 60) || "一段记忆",
    text: content.text,
    occurredAt: content.occurredAt,
    occurredAtPrecision: content.occurredAtPrecision,
    uri: original?.media_type === "image" ? original.local_uri : null,
    visibility: content.visibility,
  };
}
