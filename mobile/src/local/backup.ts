import { File, FileMode } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as Sharing from "expo-sharing";
import {
  backupDirectory,
  deleteMediaFiles,
  ensureDirectories,
  mediaDirectory,
  mediaFile,
  mediaUri,
  renderThumb,
  verifyMedia,
} from "./files";
import {
  BACKUP_MAGIC,
  HEADER_LIMIT,
  encodeHeader,
  decodeManifest,
} from "./backup-format";
import { clone, type Library } from "./model";
import type { LocalStore } from "./store";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Local retention names sort lexicographically in creation order, across formats. */
export function backupFileName(at: Date, id: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `xiaomei-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}-${id}.xmb`;
}
/** Calendar days since the last export; null when there has never been a valid one. */
export function daysSinceExport(
  state: Pick<Library, "lastExportAt">,
  today = new Date(),
): number | null {
  if (!state.lastExportAt) return null;
  const exported = new Date(state.lastExportAt);
  if (Number.isNaN(exported.getTime())) return null;
  const start = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.floor((start(today) - start(exported)) / 86400000);
}
/** Keeps only the newest local retention copies; exports outside the app are untouched. */
export function pruneBackups(keep = 3, protect?: File): void {
  if (!backupDirectory.exists) return;
  const others = backupDirectory
    .list()
    .filter(
      (f): f is File =>
        f instanceof File && f.name.endsWith(".xmb") && f.uri !== protect?.uri,
    )
    .sort((a, b) => b.name.localeCompare(a.name));
  // 同一分钟内名字的字典序不等于创建顺序，因此给刚创建的这份预留一个保留位，
  // 再按名字清掉最旧的其余备份。
  const doomed = protect ? others.slice(keep - 1) : others.slice(keep);
  for (const file of doomed) if (file.exists) file.delete();
}
export async function createBackup(state: Library): Promise<File> {
  ensureDirectories();
  const header = encodeHeader(state),
    out = new File(
      backupDirectory,
      backupFileName(new Date(), randomUUID().slice(0, 8)),
    );
  out.create();
  const handle = out.open(FileMode.WriteOnly);
  try {
    handle.writeBytes(header);
    for (const id of Object.keys(state.media).sort()) {
      const m = state.media[id]!;
      await verifyMedia(m);
      const input = mediaFile(m).open(FileMode.ReadOnly);
      try {
        let remaining = m.bytes;
        while (remaining) {
          const bytes = input.readBytes(Math.min(262144, remaining));
          if (!bytes.length) throw new Error("素材读取失败。");
          handle.writeBytes(bytes);
          remaining -= bytes.length;
          await tick();
        }
      } finally {
        input.close();
      }
    }
  } catch (e) {
    handle.close();
    out.delete();
    throw e;
  }
  handle.close();
  try {
    await inspectBackup(out);
    pruneBackups(3, out);
    return out;
  } catch (e) {
    out.delete();
    throw e;
  }
}
/** Verify the complete stream, not just its filename or JSON. Optional extraction is isolated. */
export async function inspectBackup(
  file: File,
  extract = false,
): Promise<Library> {
  if (!file.exists || file.size < 12) throw new Error("备份文件不完整。");
  const h = file.open(FileMode.ReadOnly);
  const written: File[] = [];
  try {
    const head = h.readBytes(12);
    if (head.length !== 12 || BACKUP_MAGIC.some((b, i) => head[i] !== b))
      throw new Error("请选择小美成长记 .xmb 备份文件。");
    const length = new DataView(
      head.buffer,
      head.byteOffset,
      head.byteLength,
    ).getUint32(8);
    if (length > HEADER_LIMIT || length > file.size - 12)
      throw new Error("备份清单损坏。");
    const manifest = decodeManifest(h.readBytes(length));
    const state = clone(manifest.library);
    const expected =
      12 + length + Object.values(state.media).reduce((n, m) => n + m.bytes, 0);
    if (!Number.isSafeInteger(expected) || file.size !== expected)
      throw new Error("备份文件长度不完整。");
    ensureDirectories();
    for (const id of manifest.mediaOrder) {
      const m = state.media[id]!,
        hash = sha256.create();
      const target = extract
        ? new File(mediaDirectory, `${randomUUID()}.${m.file.split(".").pop()}`)
        : null;
      if (target) {
        target.create();
        written.push(target);
      }
      const output = target?.open(FileMode.WriteOnly);
      try {
        let remaining = m.bytes;
        while (remaining) {
          const bytes = h.readBytes(Math.min(262144, remaining));
          if (!bytes.length) throw new Error("备份素材不完整。");
          hash.update(bytes);
          output?.writeBytes(bytes);
          remaining -= bytes.length;
          await tick();
        }
        if (bytesToHex(hash.digest()) !== m.sha256)
          throw new Error(`备份素材校验失败：${m.name}`);
      } finally {
        output?.close();
      }
      if (target) m.file = target.name;
    }
    return state;
  } catch (e) {
    for (const f of written) if (f.exists) f.delete();
    throw e;
  } finally {
    h.close();
  }
}
export async function restoreBackup(
  store: LocalStore,
  file: File,
): Promise<File> {
  let prior: File | null = null;
  let restored: Library | null = null;
  try {
    await store.change(async (current) => {
      prior = await createBackup(current);
      restored = await inspectBackup(file, true);
      Object.assign(current, restored);
      // 备份不含缩略图字节；用全新随机名重生成，避免与当前库的缩略图文件
      // 同名——失败清理才能只删本次恢复新产生的文件。
      for (const m of Object.values(current.media)) {
        if (m.kind !== "image" && m.kind !== "video") continue;
        const thumb = await renderThumb(m.kind, mediaUri(m), randomUUID());
        if (thumb) Object.assign(m, thumb);
      }
    });
  } catch (e) {
    if (restored)
      for (const m of Object.values((restored as Library).media))
        deleteMediaFiles(m);
    throw e;
  }
  return prior!;
}
export async function shareBackup(file: File) {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("此设备暂不支持导出，请稍后重试。");
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/octet-stream",
    UTI: "public.data",
    dialogTitle: "保存本机备份",
  });
}

/** Used only before a library could be opened. The unreadable original database stays in place. */
export async function recoverStartupBackup(file: File): Promise<void> {
  const restored = await inspectBackup(file, true);
  // 与 restoreBackup 相同：恢复后的缩略图用全新随机名重建。
  for (const m of Object.values(restored.media)) {
    if (m.kind !== "image" && m.kind !== "video") continue;
    const thumb = await renderThumb(m.kind, mediaUri(m), randomUUID());
    if (thumb) Object.assign(m, thumb);
  }
  try {
    const { activateRecoveredLibrary } = await import("./activation");
    await activateRecoveredLibrary(restored);
  } catch (e) {
    for (const media of Object.values(restored.media)) deleteMediaFiles(media);
    throw e;
  }
}
