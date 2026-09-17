import { randomUUID } from "expo-crypto";
import { Paths } from "expo-file-system";
import {
  consumePendingNativeShares,
  acknowledgeNativeShare,
  type NativeShareItem,
  type NativeShareManifest,
} from "../../modules/share-intake/src";
import {
  clone,
  emptyContent,
  referencedMedia,
  type Library,
  type MediaKind,
  type LocalMedia,
  type PhotoMetadata,
  type RecordDraft,
} from "./model";
import { mediaFile, preserveMedia } from "./files";
import { applyPhotoMetadata } from "./photo-metadata";
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
      autoDate: !record,
      autoLocation: !record,
      groupPhotosByDay: !record,
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
/** Native capture fields are optional and untrusted; keep only what validateLibrary would accept. */
function shareItemPhotoMetadata(item: NativeShareItem): PhotoMetadata | undefined {
  const result: PhotoMetadata = {};
  if (
    typeof item.capturedAt === "string" &&
    Number.isFinite(Date.parse(item.capturedAt))
  )
    result.capturedAt = item.capturedAt;
  if (
    typeof item.latitude === "number" &&
    typeof item.longitude === "number" &&
    Number.isFinite(item.latitude) &&
    Number.isFinite(item.longitude) &&
    Math.abs(item.latitude) <= 90 &&
    Math.abs(item.longitude) <= 180
  ) {
    result.latitude = item.latitude;
    result.longitude = item.longitude;
  }
  return Object.keys(result).length ? result : undefined;
}

/** Handles one manifest; returns how many of its items were skipped as unusable. */
async function receiveOneShare(
  store: LocalStore,
  manifest: NativeShareManifest,
): Promise<number> {
  const base = `${Paths.document.uri.replace(/\/$/, "")}/xiaomei-v1/intake/originals/`;
  const media: LocalMedia[] = [];
  const text: string[] = [];
  let skipped = 0;
  for (const item of manifest.items) {
    if (item.kind === "text" && item.text) {
      text.push(item.text);
      continue;
    }
    if (item.kind !== "file" || !item.localUri || !item.fileName) {
      skipped++;
      continue;
    }
    if (
      !item.localUri.startsWith(base) ||
      item.localUri.slice(base.length).includes("/") ||
      item.localUri.includes("..")
    ) {
      skipped++;
      continue;
    }
    const kind: MediaKind =
      item.mediaType ??
      (item.mimeType?.startsWith("image/")
        ? "image"
        : item.mimeType?.startsWith("video/")
          ? "video"
          : item.mimeType?.startsWith("audio/")
            ? "audio"
            : "document");
    try {
      const preserved = await preserveMedia(item.localUri, item.fileName, kind);
      const photo = shareItemPhotoMetadata(item);
      if (photo) preserved.photoMetadata = photo;
      media.push(preserved);
    } catch {
      skipped++;
    }
  }
  if (!text.length && !media.length) {
    // 无可保存内容时不建空草稿；确认接收以免这条任务每次启动都重放。
    await acknowledgeNativeShare(manifest.manifestId);
    return Math.max(skipped, 1);
  }
  try {
    await store.change((s) => {
      if (s.receivedShares.includes(manifest.manifestId)) return;
      const id = newId();
      const content = emptyContent();
      content.text = text.join("\n");
      content.mediaIds = media.map((m) => m.id);
      content.coverId = media.find((m) => m.kind === "image")?.id ?? null;
      for (const m of media) s.media[m.id] = m;
      // 与编辑器导入一致：按拍摄信息自动落日期地点，并建议按天分组。
      const draft: RecordDraft = {
        id,
        recordId: null,
        baseRevision: 0,
        autoDate: true,
        autoLocation: true,
        groupPhotosByDay: true,
        content,
        updatedAt: now(),
      };
      s.drafts[id] = media.reduce(
        (next, item) => applyPhotoMetadata(next, item.photoMetadata),
        draft,
      );
      s.receivedShares.push(manifest.manifestId);
    });
  } catch (e) {
    // 库写入失败时收回已复制的文件，避免重试时静默膨胀。
    for (const m of media) {
      const f = mediaFile(m);
      if (f.exists) f.delete();
    }
    throw e;
  }
  await acknowledgeNativeShare(manifest.manifestId);
  return skipped;
}
export async function receiveShares(store: LocalStore): Promise<void> {
  const failed: string[] = [];
  let skipped = 0;
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
    try {
      skipped += await receiveOneShare(store, manifest);
    } catch (e) {
      failed.push(
        `一份分享未能保存：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  // 单批失败不影响其余批次；有批未确认时会保留原生任务，下次启动重试。
  if (failed.length)
    throw new Error(
      [
        ...failed,
        "原接收任务已保留，请重试。",
        ...(skipped
          ? [`另有 ${skipped} 份分享素材未能保存，其余已存为草稿。`]
          : []),
      ].join("\n"),
    );
  if (skipped)
    throw new Error(
      `有 ${skipped} 份分享素材未能保存，其余已存为草稿。这些素材已确认接收，不会重复导入。`,
    );
}
