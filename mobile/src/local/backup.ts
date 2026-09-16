import { File, FileMode } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as Sharing from "expo-sharing";
import {
  backupDirectory,
  ensureDirectories,
  mediaDirectory,
  mediaFile,
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
export async function createBackup(state: Library): Promise<File> {
  ensureDirectories();
  const header = encodeHeader(state),
    out = new File(
      backupDirectory,
      `xiaomei-${Date.now()}-${randomUUID()}.xmb`,
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
    });
  } catch (e) {
    if (restored)
      for (const m of Object.values((restored as Library).media)) {
        const f = mediaFile(m);
        if (f.exists) f.delete();
      }
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
  try {
    const { activateRecoveredLibrary } = await import("./activation");
    await activateRecoveredLibrary(restored);
  } catch (e) {
    for (const media of Object.values(restored.media)) {
      const f = mediaFile(media);
      if (f.exists) f.delete();
    }
    throw e;
  }
}
