import { Directory, File, FileMode, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
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
    return { id, file, kind, name, bytes: target.size, sha256: hash };
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
