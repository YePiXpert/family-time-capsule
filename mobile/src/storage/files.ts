import { Directory, File, Paths, UploadType } from "expo-file-system";
import type { ImagePickerAsset } from "expo-image-picker";
import { ApiError } from "../api/client";
import type { Credentials, MediaCapturePayload, TimelineEvent } from "../types";

const capturesDirectory = new Directory(Paths.document, "captures");
const coversDirectory = new Directory(Paths.document, "offline-covers");

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
    lastModified: Date.now(),
    mediaType: asset.type === "video" ? "video" : "image",
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
  };
}

export async function uploadMediaCapture(
  credentials: Credentials,
  captureId: string,
  payload: MediaCapturePayload,
): Promise<void> {
  const file = new File(payload.localUri);
  if (!file.exists) throw new Error("本地原件已不存在。");
  const endpoint = payload.mediaType === "image" ? "image" : "media";
  const result = await file.upload(
    `${credentials.serverUrl}/api/upload/${endpoint}`,
    {
      httpMethod: "POST",
      uploadType: UploadType.MULTIPART,
      fieldName: "file",
      mimeType: payload.mimeType,
      parameters: {
        captureId,
        filename: payload.fileName,
        lastModified: String(payload.lastModified),
      },
      headers: {
        authorization: `Bearer ${credentials.token}`,
      },
      sessionType: "background",
    },
  );
  if (result.status < 200 || result.status >= 300) {
    const message =
      result.status === 401
        ? "登录已过期，请重新登录。"
        : result.status === 403
          ? "当前账号没有记录权限。"
          : result.status === 411
            ? "服务器未接受原生分段上传。"
            : result.status === 413
              ? "原件超过服务器大小限制。"
              : result.status === 415
                ? "服务器不支持这个原件格式。"
                : `媒体上传失败（${result.status}）。`;
    throw new ApiError(message, result.status);
  }
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
