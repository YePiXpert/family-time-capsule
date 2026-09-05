import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { randomUUID } from "expo-crypto";
import type { Credentials } from "../types";
import type { NativeReaderAsset } from "./NativeMediaReader";
/** Explicit OS export of a copy; temporary sharing files never touch originals/outbox. */
export async function exportOriginalCopy(
  item: NativeReaderAsset,
  credentials: Credentials | null,
) {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("此设备暂不支持文件导出。");
  if (item.localUri) {
    await Sharing.shareAsync(item.localUri, {
      mimeType: item.mimeType || undefined,
    });
    return;
  }
  if (!credentials || !FileSystem.cacheDirectory)
    throw new Error("连接服务器后可导出原件。");
  const extension = /^[a-z0-9]{1,8}$/i.test(
    item.filename.split(".").at(-1) || "",
  )
    ? item.filename.split(".").at(-1)!
    : "bin";
  const uri = `${FileSystem.cacheDirectory}reading-export-${randomUUID()}.${extension}`;
  let sharedUri = uri;
  try {
    const result = await FileSystem.createDownloadResumable(
      `${credentials.serverUrl}/api/media/${encodeURIComponent(item.id)}?download=1`,
      uri,
      { headers: { Authorization: `Bearer ${credentials.token}` } },
    ).downloadAsync();
    if (!result || result.status !== 200)
      throw new Error(
        result?.status === 403 || result?.status === 404
          ? "当前没有导出这份原件的权限。"
          : "下载未完成，请检查网络后重试。",
      );
    const mimeType =
      Object.entries(result.headers)
        .find(([key]) => key.toLowerCase() === "content-type")?.[1]
        ?.split(";")[0] || item.mimeType;
    const extensions: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
      "video/mp4": "mp4",
      "video/quicktime": "mov",
      "video/webm": "webm",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/mp4": "m4a",
      "audio/mpeg": "mp3",
      "audio/ogg": "ogg",
      "application/pdf": "pdf",
    };
    if (extensions[mimeType]) {
      sharedUri = `${uri}.${extensions[mimeType]}`;
      await FileSystem.moveAsync({ from: uri, to: sharedUri });
    }
    await Sharing.shareAsync(sharedUri, { mimeType });
  } finally {
    await FileSystem.deleteAsync(sharedUri, { idempotent: true });
    if (sharedUri !== uri)
      await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}
