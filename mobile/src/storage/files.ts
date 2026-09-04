import { Directory, File, FileMode, Paths } from "expo-file-system";
import type { DocumentPickerAsset } from "expo-document-picker";
import type { ImagePickerAsset } from "expo-image-picker";
import { Asset as MediaLibraryAsset } from "expo-media-library";
import { ApiError } from "../api/client";
import { resolveReliableMediaTime, type MediaCaptureSource } from "../media/capture-time";
import { classifyImportedFile } from "./import-policy";
import type { Credentials, MediaCapturePayload, TimelineEvent } from "../types";

const capturesDirectory = new Directory(Paths.document, "captures");
const coversDirectory = new Directory(Paths.document, "offline-covers");
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

function ensureDirectories(): void {
  capturesDirectory.create({ idempotent: true, intermediates: true });
  coversDirectory.create({ idempotent: true, intermediates: true });
}

function safeExtension(asset: ImagePickerAsset): string {
  const match = asset.fileName?.match(/\.([a-z0-9]{1,8})$/iu);
  if (match?.[1]) return match[1].toLowerCase();
  return asset.type === "video" ? "mp4" : "jpg";
}

export async function preservePickedMedia(
  asset: ImagePickerAsset,
  id: string,
  source: Extract<MediaCaptureSource, "camera" | "library">,
): Promise<MediaCapturePayload> {
  ensureDirectories();
  const extension = safeExtension(asset);
  const destination = new File(capturesDirectory, `${id}.${extension}`);
  await new File(asset.uri).copy(destination, { overwrite: false });
  return {
    localUri: destination.uri,
    fileName: asset.fileName?.slice(0, 200) || `capture-${id}.${extension}`,
    mimeType:
      asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg"),
    lastModified: await resolveReliableMediaTime(
      source,
      asset.assetId,
      async (assetId) => {
        const libraryAsset = new MediaLibraryAsset(assetId);
        const [creationTime, modificationTime] = await Promise.all([
          libraryAsset.getCreationTime(),
          libraryAsset.getModificationTime(),
        ]);
        return { creationTime, modificationTime };
      },
    ),
    mediaType: asset.type === "video" ? "video" : "image",
    source,
  };
}

/** Copy a completed recorder file before it can be reclaimed by the OS. */
export async function preserveRecordedAudio(
  sourceUri: string,
  id: string,
): Promise<MediaCapturePayload> {
  ensureDirectories();
  const extension = sourceUri.match(/\.([a-z0-9]{1,8})(?:\?|$)/iu)?.[1] ?? "m4a";
  const destination = new File(capturesDirectory, `${id}.${extension}`);
  await new File(sourceUri).copy(destination, { overwrite: false });
  return {
    localUri: destination.uri,
    fileName: `voice-${id}.${extension}`,
    mimeType: extension.toLowerCase() === "webm" ? "audio/webm" : "audio/mp4",
    lastModified: Date.now(),
    mediaType: "audio",
    source: "recorder",
  };
}

export async function preservePickedDocument(
  asset: DocumentPickerAsset,
  id: string,
): Promise<MediaCapturePayload> {
  ensureDirectories();
  const classification = classifyImportedFile(asset.name, asset.mimeType);
  if (!classification) throw new Error("只支持照片、音频、视频、PDF、TXT、Markdown、RTF 或 DOCX。");
  const extension = asset.name.match(/\.([a-z0-9]{1,8})$/iu)?.[1]?.toLowerCase() ?? "bin";
  const destination = new File(capturesDirectory, `${id}.${extension}`);
  try {
    await new File(asset.uri).copy(destination, { overwrite: false });
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
  return {
    localUri: destination.uri,
    fileName: asset.name.slice(0, 200) || `document-${id}.${extension}`,
    mimeType: classification.mimeType,
    // Provider timestamps are not reliable source capture times. Preserve null
    // instead of substituting selection or import time.
    lastModified: null,
    mediaType: classification.mediaType,
    source: "files",
  };
}

type UploadProgress = (uploadId: string, uploadOffset: number) => Promise<void>;

function uploadError(status: number, fallback = "原件上传失败"): ApiError {
  const message = status === 401
    ? "登录已过期，请重新登录。"
    : status === 403
      ? "当前账号没有记录权限。"
      : status === 409
        ? "服务器上传位置不一致，稍后将安全重试。"
        : status === 413
          ? "原件超过服务器大小限制。"
          : status === 415
            ? "服务器不支持这个原件格式。"
            : `${fallback}（${status}）。`;
  return new ApiError(message, status);
}

async function confirmedOffset(
  credentials: Credentials,
  uploadId: string,
): Promise<{ offset: number; status: string | null }> {
  const response = await fetch(`${credentials.serverUrl}/api/uploads/${uploadId}`, {
    method: "HEAD",
    headers: { authorization: `Bearer ${credentials.token}` },
  });
  if (!response.ok) throw uploadError(response.status, "无法查询上传进度");
  return {
    offset: Number(response.headers.get("upload-offset") ?? 0),
    status: response.headers.get("upload-status"),
  };
}

export async function uploadMediaCapture(
  credentials: Credentials,
  captureId: string,
  payload: MediaCapturePayload,
  onProgress: UploadProgress = async () => undefined,
): Promise<string> {
  const file = new File(payload.localUri);
  if (!file.exists) throw new Error("本地原件已不存在。");
  const totalBytes = file.size;
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) throw new Error("本地原件为空或大小无效。");
  let uploadId = payload.uploadId;
  let offset = payload.uploadOffset ?? 0;
  if (uploadId) {
    try {
      const confirmed = await confirmedOffset(credentials, uploadId);
      offset = confirmed.offset;
      if (["failed", "expired", "cancelled"].includes(confirmed.status ?? "")) {
        const retry = await fetch(`${credentials.serverUrl}/api/uploads/${uploadId}/retry`, {
          method: "POST",
          headers: { authorization: `Bearer ${credentials.token}` },
        });
        if (!retry.ok) throw uploadError(retry.status, "无法恢复上传");
        const body = await retry.json() as { uploadOffset?: number };
        offset = Number(body.uploadOffset ?? 0);
      }
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      uploadId = undefined;
      offset = 0;
    }
  }
  if (!uploadId) {
    const response = await fetch(`${credentials.serverUrl}/api/uploads`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credentials.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        captureId,
        filename: payload.fileName,
        declaredMime: payload.mimeType,
        totalBytes,
        lastModified: payload.lastModified,
        source: payload.source === "system_share" ? "share" : "native",
        importSessionId: null,
      }),
    });
    if (!response.ok) throw uploadError(response.status, "无法创建上传");
    const created = await response.json() as {
      uploadId?: string;
      uploadOffset?: number;
      status?: string;
      inboxItemId?: string;
    };
    if (typeof created.uploadId !== "string") throw new ApiError("服务器上传结果无效。", 502);
    uploadId = created.uploadId;
    offset = Number(created.uploadOffset ?? 0);
    await onProgress(uploadId, offset);
    if (created.status === "completed" && typeof created.inboxItemId === "string") {
      return created.inboxItemId;
    }
  }
  await onProgress(uploadId, offset);

  const handle = file.open(FileMode.ReadOnly);
  try {
    while (offset < totalBytes) {
      handle.offset = offset;
      const chunk = handle.readBytes(Math.min(UPLOAD_CHUNK_BYTES, totalBytes - offset));
      if (chunk.byteLength === 0) throw new Error("读取本地原件时提前结束。");
      const response = await fetch(`${credentials.serverUrl}/api/uploads/${uploadId}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${credentials.token}`,
          "content-type": "application/offset+octet-stream",
          "content-length": String(chunk.byteLength),
          "upload-offset": String(offset),
        },
        body: chunk as unknown as BodyInit,
      });
      if (response.status === 409) {
        offset = Number(response.headers.get("upload-offset") ?? offset);
        await onProgress(uploadId, offset);
        continue;
      }
      if (!response.ok) throw uploadError(response.status);
      offset = Number(response.headers.get("upload-offset") ?? offset + chunk.byteLength);
      await onProgress(uploadId, offset);
    }
  } finally {
    handle.close();
  }
  const completed = await fetch(`${credentials.serverUrl}/api/uploads/${uploadId}/complete`, {
    method: "POST",
    headers: { authorization: `Bearer ${credentials.token}` },
  });
  if (!completed.ok) throw uploadError(completed.status, "无法完成上传");
  const body = await completed.json() as { inboxItemId?: string };
  if (typeof body.inboxItemId !== "string") throw new ApiError("服务器媒体上传结果无效。", 502);
  return body.inboxItemId;
}

export function removeLocalFile(uri: string): void {
  const file = new File(uri);
  if (file.exists) file.delete();
}

export function clearLocalFiles(): void {
  if (capturesDirectory.exists) capturesDirectory.delete();
  if (coversDirectory.exists) coversDirectory.delete();
}

export function pruneCachedCovers(referencedUris: string[]): void {
  if (!coversDirectory.exists) return;
  const referenced = new Set(referencedUris);
  for (const entry of coversDirectory.list()) {
    if (entry instanceof File && !referenced.has(entry.uri)) {
      entry.delete();
    }
  }
}

export async function cacheEventCover(
  credentials: Credentials,
  event: TimelineEvent,
): Promise<string | null> {
  if (!event.cover || event.cover.type !== "image") return null;
  ensureDirectories();
  const destination = new File(
    coversDirectory,
    `${event.cover.mediaAssetId}.img`,
  );
  if (!destination.exists) {
    const temporary = new File(
      coversDirectory,
      `${event.cover.mediaAssetId}.${Date.now()}.part`,
    );
    try {
      await File.downloadFileAsync(
        `${credentials.serverUrl}${event.cover.path}`,
        temporary,
        {
          headers: { authorization: `Bearer ${credentials.token}` },
          idempotent: true,
        },
      );
      await temporary.move(destination);
    } catch (error) {
      if (temporary.exists) temporary.delete();
      throw error;
    }
  }
  return destination.uri;
}
