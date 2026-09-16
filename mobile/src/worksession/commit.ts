import { randomUUID } from "expo-crypto";
import { mutateBook, requestMobileJson } from "../api/client";
import type { Credentials } from "../types";
import {
  materialKey,
  appendAlbumItems,
  getLocalAlbum,
  newLocalAlbum,
  saveLocalAlbum,
  listLocalAlbums,
  type LocalAlbum,
} from "../collections/local";
import { authorizeAlbumSync } from "../collections/sync";
import { getActiveDestination } from "../storage/database";
import { saveWorkSession, type WorkSession } from "./store";
export async function commitWorkSession(
  session: WorkSession,
  credentials: Credentials | null,
  options: { authorizeSources?: boolean } = {},
): Promise<{ kind: "localAlbum" | "collection" | "book"; id: string }> {
  const { target, selected, scope } = session;
  if (scope !== "local" && (await getActiveDestination()) !== scope)
    throw new Error("家庭已变化，之前的选择仍保留，请返回当前家庭。");
  if (!selected.length) throw new Error("请先选择内容。");
  if (target.mode === "create" && target.kind === "album") {
    const album = newLocalAlbum(
      scope,
      session.title.trim() || "新相册",
      selected,
    );
    // The session's stable ID also makes local creation safe after interruption.
    album.id = session.id;
    album.coverItemId =
      album.items.find((i) => materialKey(i.ref) === session.coverRefKey)?.id ??
      null;
    if (!(await getLocalAlbum(scope, album.id))) await saveLocalAlbum(album, 0);
    await saveWorkSession({ ...session, completedId: album.id });
    return { kind: "localAlbum", id: album.id };
  }
  if (
    target.mode === "append" &&
    (target.kind === "localAlbum" || target.kind === "collection")
  ) {
    let album: LocalAlbum | null =
      target.kind === "localAlbum"
        ? await getLocalAlbum(scope, target.id)
        : ((await listLocalAlbums(scope)).find(
            (a) => a.remoteId === target.id,
          ) ?? null);
    if (!album && target.kind === "collection") {
      album = {
        ...newLocalAlbum(scope, "待加入的记录"),
        id: `remote-${target.id}`,
        remoteId: target.id,
        remoteRevision: target.revision ?? 0,
        consent: { scope, at: new Date().toISOString(), draftIds: [] },
      };
      await saveLocalAlbum(album, 0);
    }
    if (!album) throw new Error("相册已变化，请返回重试。");
    if (!session.completedId) {
      const next = appendAlbumItems(album, selected);
      await saveLocalAlbum(next, album.revision);
      album = next;
      await saveWorkSession({ ...session, completedId: album.id });
    }
    if (album.remoteId && options.authorizeSources)
      album = await authorizeAlbumSync(album, scope);
    return { kind: target.kind, id: target.id };
  }
  if (!credentials || selected.some((r) => r.kind === "localDraft"))
    throw new Error("成长册需要已同步记录，请先同步本机内容。");
  const selection = selected.map(({ kind, id }) => ({ kind, id }));
  if (target.mode === "append") {
    await mutateBook(credentials, target.id, {
      operation: "add",
      revision: target.revision,
      chapterId: target.chapterId,
      selection,
    });
    return { kind: "book", id: target.id };
  }
  if (session.completedId) return { kind: "book", id: session.completedId };
  const result = (await requestMobileJson(credentials, "/api/works", {
    method: "POST",
    body: JSON.stringify({
      kind: "book",
      title: session.title || undefined,
      audience: session.audience,
      template: session.template,
      selection,
      mutationId: randomUUID(),
    }),
  })) as { id: string };
  if (typeof result.id !== "string")
    throw new Error("尚未确认成长册，请返回书架核对。");
  await saveWorkSession({ ...session, completedId: result.id });
  return { kind: "book", id: result.id };
}
