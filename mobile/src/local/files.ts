import { Directory, File, FileMode, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as ImageManipulator from "expo-image-manipulator";
import * as VideoThumbnails from "expo-video-thumbnails";
import type { LocalMedia, MediaKind } from "./model";
export const mediaDirectory = new Directory(
  Paths.document,
  "xiaomei-v1",
  "media",
);
export const backupDirectory = new Directory(
  Paths.document,
  "xiaomei-v1",
  "backups",
);
export const mediaFile = (m: LocalMedia) => new File(mediaDirectory, m.file);
export const mediaUri = (m: LocalMedia) => mediaFile(m).uri;
export const thumbFile = (m: LocalMedia) =>
  m.thumb ? new File(mediaDirectory, m.thumb) : null;
export const thumbUri = (m: LocalMedia) => thumbFile(m)?.uri ?? mediaUri(m);
/** 删除素材原件与其持久缩略图；缩略图缺失不报错。 */
export function deleteMediaFiles(m: LocalMedia): void {
  const file = mediaFile(m);
  if (file.exists) file.delete();
  const thumb = thumbFile(m);
  if (thumb?.exists) thumb.delete();
}
export function ensureDirectories() {
  mediaDirectory.create({ intermediates: true, idempotent: true });
  backupDirectory.create({ intermediates: true, idempotent: true });
}
export async function hashFile(file: File): Promise<string> {
  const h = file.open(FileMode.ReadOnly);
  const hash = sha256.create();
  try {
    let remaining = file.size;
    while (remaining > 0) {
      const bytes = h.readBytes(Math.min(262144, remaining));
      if (!bytes.length) throw new Error("文件读取不完整。");
      hash.update(bytes);
      remaining -= bytes.length;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return bytesToHex(hash.digest());
  } finally {
    h.close();
  }
}
/** 生成持久 512px 缩略图并带回比例尺寸；失败不阻塞素材保存。 */
export async function renderThumb(
  kind: MediaKind,
  uri: string,
  base: string,
): Promise<{ thumb: string; width: number; height: number } | undefined> {
  if (kind !== "image" && kind !== "video") return;
  try {
    ensureDirectories();
    let source: string, width: number, height: number;
    if (kind === "image") {
      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 512 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
      );
      source = result.uri;
      width = result.width;
      height = result.height;
    } else {
      const result = await VideoThumbnails.getThumbnailAsync(uri, {
        time: 0,
      });
      source = result.uri;
      width = result.width;
      height = result.height;
    }
    const thumb = new File(mediaDirectory, `${base}_t.jpg`);
    await new File(source).copy(thumb, { overwrite: true });
    try {
      new File(source).delete();
    } catch {
      // 系统缓存目录的清理尽力而为。
    }
    return { thumb: thumb.name, width, height };
  } catch {
    return undefined;
  }
}
export async function preserveMedia(
  uri: string,
  name: string,
  kind: MediaKind,
): Promise<LocalMedia> {
  ensureDirectories();
  const id = randomUUID();
  const ext =
    name.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() ??
    (kind === "image"
      ? "jpg"
      : kind === "audio"
        ? "m4a"
        : kind === "video"
          ? "mp4"
          : "bin");
  const file = `${id}.${ext}`,
    target = new File(mediaDirectory, file),
    temporary = new File(mediaDirectory, `${id}.part`);
  try {
    await new File(uri).copy(temporary, { overwrite: false });
    if (!temporary.exists || !temporary.size)
      throw new Error("素材未能完整保存，请检查本机空间。");
    const hash = await hashFile(temporary);
    await temporary.move(target, { overwrite: false });
    const thumbnail = await renderThumb(kind, target.uri, id);
    return {
      id,
      file,
      kind,
      name,
      bytes: target.size,
      sha256: hash,
      ...(thumbnail ?? {}),
    };
  } catch (e) {
    if (temporary.exists) temporary.delete();
    throw e;
  }
}
export async function verifyMedia(m: LocalMedia) {
  const f = mediaFile(m);
  if (!f.exists || f.size !== m.bytes || (await hashFile(f)) !== m.sha256)
    throw new Error(`素材缺失或损坏：${m.name}`);
}
