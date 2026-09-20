import { Directory, File, FileMode, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as ImageManipulator from "expo-image-manipulator";
import * as VideoThumbnails from "expo-video-thumbnails";
import type { LocalMedia, MediaKind } from "./model";
import { DOCS_DIR } from "./brand";
export const mediaDirectory = new Directory(Paths.document, DOCS_DIR, "media");
export const backupDirectory = new Directory(
  Paths.document,
  DOCS_DIR,
  "backups",
);
/** 分块读写素材时的块大小：任何时刻内存里只有这么一块。 */
export const CHUNK = 262144;
/**
 * 本机 blob 库：按内容 sha256 存一份素材字节，供保留备份（.xmbm）、导出分卷与远端恢复共用。
 * 两级前缀目录（blobs/ab/ab…）避免一个目录里堆几万个文件。
 */
export const blobDirectory = new Directory(Paths.document, DOCS_DIR, "blobs");
export const blobPrefixDirectory = (sha256: string) =>
  new Directory(blobDirectory, sha256.slice(0, 2));
export const blobFile = (sha256: string) =>
  new File(blobPrefixDirectory(sha256), sha256);
/** 正在写入的半成品；长度与哈希都核过才换成正式名字。 */
export const blobPartFile = (sha256: string) =>
  new File(blobPrefixDirectory(sha256), `${sha256}.part`);
export const mediaFile = (m: LocalMedia) => new File(mediaDirectory, m.file);
export const mediaUri = (m: LocalMedia) => mediaFile(m).uri;
export const thumbFile = (m: LocalMedia) =>
  m.thumb ? new File(mediaDirectory, m.thumb) : null;
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
  blobDirectory.create({ intermediates: true, idempotent: true });
}
export type FileHandle = ReturnType<File["open"]>;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
/**
 * 逐块把一段字节从一个句柄搬到另一个，边搬边算 sha256，每块之间让出主线程；
 * output 为空时只读只算。返回十六进制哈希。
 */
export async function pumpBytes(
  input: FileHandle,
  bytes: number,
  output: FileHandle | null,
  onChunk?: (chunk: Uint8Array) => void,
): Promise<string> {
  const digest = sha256.create();
  let remaining = bytes;
  while (remaining > 0) {
    const chunk = input.readBytes(Math.min(CHUNK, remaining));
    if (!chunk.length) throw new Error("文件读取不完整。");
    digest.update(chunk);
    output?.writeBytes(chunk);
    onChunk?.(chunk);
    remaining -= chunk.length;
    await tick();
  }
  return bytesToHex(digest.digest());
}
export async function hashFile(file: File): Promise<string> {
  const h = file.open(FileMode.ReadOnly);
  try {
    return await pumpBytes(h, file.size, null);
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
