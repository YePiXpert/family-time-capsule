import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { randomUUID } from "expo-crypto";
import type { Credentials } from "../types";
import type { BookRenderStatus } from "./render-types";
/** Explicitly exports one authenticated copy. This is separate from offline collections. */
export async function exportPublication(
  credentials: Credentials,
  job: BookRenderStatus,
) {
  if (!job.downloadable || !FileSystem.cacheDirectory)
    throw new Error("产物已失效，请重新生成。");
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("此设备暂不支持文件导出。");
  const extension = job.format === "reading_zip" ? "zip" : job.format;
  const uri = `${FileSystem.cacheDirectory}publication-${randomUUID()}.${extension}`;
  try {
    const result = await FileSystem.createDownloadResumable(
      `${credentials.serverUrl}/api/books/renders/${encodeURIComponent(job.id)}/download`,
      uri,
      { headers: { Authorization: `Bearer ${credentials.token}` } },
    ).downloadAsync();
    if (!result || result.status !== 200)
      throw new Error(
        result && [401, 403, 404, 409].includes(result.status)
          ? "权限或来源已变化，不能下载此版本。请重新打开作品核对。"
          : "下载未完成，请检查网络后重试。",
      );
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists || info.size !== job.bytes)
      throw new Error("下载不完整，请重试。");
    await Sharing.shareAsync(uri, {
      mimeType:
        job.format === "pdf"
          ? "application/pdf"
          : job.format === "epub"
            ? "application/epub+zip"
            : "application/zip",
    });
  } finally {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}
