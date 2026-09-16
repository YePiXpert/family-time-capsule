import { randomUUID } from "expo-crypto";
import { ApiError, fetchBookMaterials, fetchCollection } from "../api/client";
import { getActiveDestination, getDatabase } from "../storage/database";
import {
  bindLocalDraft,
  listLocalDrafts,
  saveLocalDraft,
} from "../drafts/store";
import { savedDraftContent } from "../drafts/reading";
import type { Credentials } from "../types";
import {
  getLocalAlbum,
  listLocalAlbums,
  saveLocalAlbum,
  saveLocalAlbumInTransaction,
  type LocalAlbum,
} from "./local";
import { sendAlbumCommand } from "./api";

/** Explicit metadata AND source-upload consent; merely reconnecting never calls this. */
export async function authorizeAlbumSync(
  album: LocalAlbum,
  scope: string,
): Promise<LocalAlbum> {
  if (scope === "local" || (await getActiveDestination()) !== scope)
    throw new Error("请先连接要同步的家庭。");
  for (const item of album.items) {
    if ((await getActiveDestination()) !== scope)
      throw new Error("家庭已变化，请重新确认同步目的地。");
    if (item.ref.scope !== "local" && item.ref.scope !== scope)
      throw new Error("相册包含其他家庭的记录，请先核对来源。");
    if (item.ref.kind !== "localDraft") continue;
    const drafts = await listLocalDrafts(item.ref.scope),
      draft = drafts.find((d) => d.id === item.ref.id);
    if (!draft) throw new Error("相册中的本机记录不可读，请先处理该记录。");
    if (draft.status === "published") continue;
    const content = savedDraftContent(draft);
    if (!content) throw new Error("请先保存相册中的记录。");
    if (
      draft.status === "editing" &&
      JSON.stringify(draft.content) !== JSON.stringify(content)
    )
      throw new Error("有一条记录仍在补记，请先保存后再同步相册。");
  }
  for (const item of album.items) {
    if ((await getActiveDestination()) !== scope)
      throw new Error("家庭已变化，请重新确认同步目的地。");
    if (item.ref.scope !== "local" && item.ref.scope !== scope)
      throw new Error("相册包含其他家庭的记录，请先核对来源。");
    if (item.ref.kind !== "localDraft") continue;
    let draft = (await listLocalDrafts(item.ref.scope)).find(
      (d) => d.id === item.ref.id,
    )!;
    if (draft.scope === "local") draft = await bindLocalDraft(draft.id, scope);
    if (draft.scope !== scope) throw new Error("相册包含其他家庭的记录。");
    if (draft.status !== "published")
      await saveLocalDraft(
        {
          ...draft,
          status: "queued",
          syncIntent: "publish",
          revision: draft.revision + 1,
          mutationId: randomUUID(),
        },
        draft.revision,
      );
  }
  const db = await getDatabase();
  let result = album;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const raw = await tx.getFirstAsync<{ snapshot_json: string }>(
      "SELECT snapshot_json FROM local_album WHERE id=? AND scope IN (?, 'local')",
      album.id,
      scope,
    );
    if (!raw) throw new Error("本机相册不可读。");
    const current = JSON.parse(raw.snapshot_json) as LocalAlbum;
    result = {
      ...current,
      scope,
      items: current.items.map((i) =>
        i.ref.kind === "localDraft" && i.ref.scope === "local"
          ? { ...i, ref: { ...i.ref, scope } }
          : i,
      ),
      revision: current.revision + 1,
      consent: {
        scope,
        at: new Date().toISOString(),
        draftIds: current.items
          .filter((i) => i.ref.kind === "localDraft")
          .map((i) => i.ref.id),
      },
      pending: current.pending ?? {
        mutationId: randomUUID(),
        itemIds: current.items
          .filter((i) => !i.remoteItemId)
          .slice(0, 100)
          .map((i) => i.id),
      },
      error: "",
    };
    if (current.scope !== scope)
      await tx.runAsync(
        "DELETE FROM local_album WHERE scope=? AND id=?",
        current.scope,
        current.id,
      );
    await saveLocalAlbumInTransaction(
      tx,
      result,
      current.scope === scope ? current.revision : 0,
    );
  });
  return result;
}

/** Called after draft sync. All retries reuse the durable immutable command. */
export async function syncLocalAlbums(
  credentials: Credentials,
  options: { isCurrent?: () => boolean } = {},
) {
  const scope = await getActiveDestination();
  if (!scope) return;
  const guard = async () => {
    if (
      options.isCurrent?.() === false ||
      (await getActiveDestination()) !== scope
    )
      throw new ApiError(
        "连接已切换，添加内容仍保留。",
        409,
        "connection_changed",
      );
  };
  for (const initial of await listLocalAlbums(scope)) {
    if (!initial.pending || initial.consent?.scope !== scope) continue;
    let row = initial;
    try {
      await guard();
      const drafts = await listLocalDrafts(scope);
      const items = row.items
        .filter((i) => row.pending!.itemIds.includes(i.id))
        .map((item) => ({
          clientItemId: item.id,
          memoryEventId:
            item.ref.kind === "memory"
              ? item.ref.id
              : drafts.find(
                  (d) => d.id === item.ref.id && d.status === "published",
                )?.memoryEventId,
        }));
      if (items.some((i) => !i.memoryEventId)) continue;
      if (!row.pending!.command) {
        const cover = row.items.find((i) => i.id === row.coverItemId);
        let coverAssetId: string | null = null;
        if (!row.remoteId && cover) {
          const coverMemory = items.find(
            (i) => i.clientItemId === cover.id,
          )?.memoryEventId;
          if (coverMemory) {
            await guard();
            const page = await fetchBookMaterials(
              credentials,
              "memory",
              "personal",
              "",
              "",
              [coverMemory],
            );
            await guard();
            coverAssetId =
              page.entries[0]?.images?.find((i) => i.type === "image")?.id ??
              null;
          }
        }
        const uniqueItems = [
          ...new Map(items.map((item) => [item.memoryEventId, item])).values(),
        ];
        const command = {
          mutationId: row.pending!.mutationId,
          target: row.remoteId
            ? { collectionId: row.remoteId, baseRevision: row.remoteRevision }
            : {
                clientAlbumId: row.id,
                title: row.title,
                publishMetadata: true as const,
                coverAssetId,
              },
          items: uniqueItems as {
            clientItemId: string;
            memoryEventId: string;
          }[],
        };
        const next = {
          ...row,
          pending: { ...row.pending!, command },
          revision: row.revision + 1,
        };
        await guard();
        await saveLocalAlbum(next, row.revision);
        row = next;
      }
      await guard();
      const result = await sendAlbumCommand(credentials, row.pending!.command!);
      await guard();
      const live = await getLocalAlbum(scope, row.id);
      if (live?.revision !== row.revision)
        throw new Error("相册已改变，服务器结果将在重试时核对。");
      const resolvedItems = row.items.map((i) => {
        const memoryId = items.find(
          (r) => r.clientItemId === i.id,
        )?.memoryEventId;
        const mapped = result.items.find(
          (m) =>
            m.clientItemId === i.id ||
            (!!memoryId && m.memoryEventId === memoryId),
        );
        return mapped
          ? {
              ...i,
              remoteItemId: mapped.itemId,
              ref: { kind: "memory" as const, scope, id: mapped.memoryEventId },
            }
          : i;
      });
      const seen = new Map<string, string>(),
        aliases = new Map<string, string>();
      const updatedItems = resolvedItems.filter((item) => {
        if (!item.remoteItemId) return true;
        const canonical = seen.get(item.remoteItemId);
        if (canonical) {
          aliases.set(item.id, canonical);
          return false;
        }
        seen.set(item.remoteItemId, item.id);
        return true;
      });
      const remaining = updatedItems
        .filter((i) => !i.remoteItemId)
        .slice(0, 100);
      await saveLocalAlbum(
        {
          ...row,
          remoteId: result.id,
          remoteRevision: result.revision,
          coverItemId: row.coverItemId
            ? (aliases.get(row.coverItemId) ?? row.coverItemId)
            : null,
          items: updatedItems,
          pending: remaining.length
            ? { mutationId: randomUUID(), itemIds: remaining.map((i) => i.id) }
            : null,
          error: "",
          revision: row.revision + 1,
        },
        row.revision,
      );
    } catch (error) {
      if (
        options.isCurrent?.() === false ||
        (await getActiveDestination()) !== scope
      )
        return;
      const live = await getLocalAlbum(scope, row.id);
      if (live?.revision !== row.revision) continue;
      const next = {
        ...row,
        error: (error as Error).message,
        syncRejected:
          error instanceof ApiError &&
          error.code === "source_unavailable_not_applied",
        revision: row.revision + 1,
      };
      // A rejected additive command may safely rebase after explicitly reading current revision.
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.code === "revision_conflict" &&
        row.remoteId
      ) {
        try {
          const current = await fetchCollection(credentials, row.remoteId);
          await guard();
          if (
            !current.deletedAt &&
            current.canWrite &&
            row.pending?.command &&
            "baseRevision" in row.pending.command.target
          ) {
            next.remoteRevision = current.revision;
            next.pending = {
              ...row.pending,
              mutationId: randomUUID(),
              command: undefined,
            };
            next.error = "家人更新了相册，已保留待加入内容，将按最新版本重试。";
          }
        } catch {
          /* Keep the immutable receipt and local additions until readable again. */
        }
      }
      await saveLocalAlbum(next, row.revision);
    }
  }
}
