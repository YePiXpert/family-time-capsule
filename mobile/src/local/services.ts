import { randomUUID } from "expo-crypto";
import { Paths } from "expo-file-system";
import {
  consumePendingNativeShares,
  acknowledgeNativeShare,
} from "../../modules/share-intake/src";
import {
  clone,
  emptyContent,
  referencedMedia,
  type Library,
  type MediaKind,
  type LocalMedia,
  type RecordDraft,
} from "./model";
import { mediaFile, preserveMedia } from "./files";
import type { LocalStore } from "./store";
export const newId = () => randomUUID();
export const now = () => new Date().toISOString();
export async function beginDraft(
  store: LocalStore,
  recordId: string | null = null,
) {
  return store.change((s) => {
    const existing = recordId
      ? Object.values(s.drafts).find((d) => d.recordId === recordId)
      : null;
    if (existing) return existing.id;
    const record = recordId ? s.records[recordId] : null;
    if (recordId && !record) throw new Error("记录已删除。");
    const id = newId();
    s.drafts[id] = {
      id,
      recordId,
      baseRevision: record?.revision ?? 0,
      content: record ? clone(record) : emptyContent(),
      updatedAt: now(),
    };
    return id;
  });
}
export function updateDraft(s: Library, draft: RecordDraft) {
  if (!s.drafts[draft.id]) throw new Error("草稿已关闭，请重新打开。");
  s.drafts[draft.id] = clone(draft);
}
export async function beginSelection(
  store: LocalStore,
  albumId: string | null = null,
  selected: string[] = [],
) {
  return store.change((s) => {
    if (albumId && !s.albums[albumId]) throw new Error("相册已删除。");
    const previous = Object.values(s.selections).find(
      (q) => q.albumId === albumId,
    );
    if (previous) {
      previous.selected = [...new Set([...previous.selected, ...selected])];
      return previous.id;
    }
    const id = newId();
    s.selections[id] = {
      id,
      albumId,
      selected,
      month: "",
      offset: 0,
      name: "",
      coverId: null,
    };
    return id;
  });
}
export async function collectUnusedMedia(store: LocalStore) {
  const removed = await store.change((s) => {
    const refs = referencedMedia(s);
    const unused = Object.values(s.media).filter((m) => !refs.has(m.id));
    for (const m of unused) delete s.media[m.id];
    return unused;
  });
  for (const m of removed) {
    const f = mediaFile(m);
    if (f.exists) f.delete();
  }
  return removed.reduce((n, m) => n + m.bytes, 0);
}
export async function receiveShares(store: LocalStore): Promise<void> {
  for (const manifest of await consumePendingNativeShares()) {
    if (
      !manifest.complete ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(manifest.manifestId)
    )
      continue;
    if (store.get().receivedShares.includes(manifest.manifestId)) {
      await acknowledgeNativeShare(manifest.manifestId);
      continue;
    }
    const media: LocalMedia[] = [];
    const text: string[] = [];
    for (const item of manifest.items) {
      if (item.kind === "text" && item.text) text.push(item.text);
      else if (item.kind === "file" && item.localUri && item.fileName) {
        const base = `${Paths.document.uri.replace(/\/$/, "")}/captures/`;
        if (
          !item.localUri.startsWith(base) ||
          item.localUri.slice(base.length).includes("/") ||
          item.localUri.includes("..")
        )
          throw new Error("收到的素材路径无效。");
        const kind: MediaKind =
          item.mediaType ??
          (item.mimeType?.startsWith("image/")
            ? "image"
            : item.mimeType?.startsWith("video/")
              ? "video"
              : item.mimeType?.startsWith("audio/")
                ? "audio"
                : "document");
        media.push(await preserveMedia(item.localUri, item.fileName, kind));
      } else throw new Error("有分享素材未能保存，原接收任务已保留，请重试。");
    }
    await store.change((s) => {
      if (s.receivedShares.includes(manifest.manifestId)) return;
      const id = newId(),
        content = emptyContent();
      content.text = text.join("\n");
      content.mediaIds = media.map((m) => m.id);
      content.coverId = media.find((m) => m.kind === "image")?.id ?? null;
      for (const m of media) s.media[m.id] = m;
      s.drafts[id] = {
        id,
        recordId: null,
        baseRevision: 0,
        content,
        updatedAt: now(),
      };
      s.receivedShares.push(manifest.manifestId);
    });
    await acknowledgeNativeShare(manifest.manifestId);
  }
}
