import { File } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { useEffect } from "react";
import { installAttachmentLoader } from "../local/attachments";
import {
  blobFile,
  ensureDirectories,
  mediaDirectory,
  mediaFile,
} from "../local/files";
import type { LocalMedia, Stored } from "../local/model";
import { downloadBlob } from "./engine";
import { loadKey } from "./state";
import { createTransport } from "./transport";

// Serialize per blob: two readers must not overwrite each other's .part download.
const pending = new Map<string, Promise<void>>();
export async function fetchAttachment(
  media: Stored<LocalMedia>,
  signal?: AbortSignal,
): Promise<void> {
  const key = await loadKey();
  if (!key) throw new Error("请先加入家庭，再下载原件。");
  if (signal?.aborted) throw new Error("已停止。");
  const id = `${Array.from(key).join(",")}:${media.sha256}`;
  const previous = pending.get(id);
  const job = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => {
      if (signal?.aborted) throw new Error("已停止。");
      return downloadBlob(
        { sha256: media.sha256, bytes: media.bytes },
        { key, transport: createTransport(), signal },
        media.name,
      );
    });
  pending.set(id, job);
  try {
    await job;
  } finally {
    if (pending.get(id) === job) pending.delete(id);
  }
  if (signal?.aborted) throw new Error("已停止。");
  const currentKey = await loadKey();
  if (!currentKey || currentKey.some((b, i) => b !== key[i]))
    throw new Error("家庭身份已改变，请重新打开附件。");
  ensureDirectories();
  const target = mediaFile(media);
  if (target.exists && target.size === media.bytes) return;
  const part = new File(mediaDirectory, `${randomUUID()}.part`);
  let moved = false;
  try {
    await blobFile(media.sha256).copy(part);
    if (signal?.aborted) throw new Error("已停止。");
    await part.move(target, { overwrite: true });
    moved = true;
  } finally {
    if (!moved && part.exists) part.delete();
  }
}
export function useAttachmentDownloads(): void {
  useEffect(() => installAttachmentLoader(fetchAttachment), []);
}
