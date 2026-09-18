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
} from "./files";
import {
  BACKUP_MAGIC,
  BACKUP_MAGIC_V2,
  HEADER_LIMIT,
  META_LIMIT,
  backupBlobs,
  decodeLibraryV2,
  decodeMetaV2,
  decodeManifest,
  encodeEntities,
  encodeMetaV2,
} from "./backup-format";
import {
  ENTITY_KINDS,
  clone,
  type Library,
  type LocalMedia,
  type Stored,
} from "./model";
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
const entityCount = (state: Library) =>
  ENTITY_KINDS.reduce((n, kind) => n + Object.keys(state[kind]).length, 0);
/** 每个 sha256 取一条代表素材：同一张照片存了两次，备份里也只写一份字节。 */
function blobOwners(state: Library): Map<string, Stored<LocalMedia>> {
  const owners = new Map<string, Stored<LocalMedia>>();
  for (const id of Object.keys(state.media).sort()) {
    const m = state.media[id]!;
    if (!owners.has(m.sha256)) owners.set(m.sha256, m);
  }
  return owners;
}
export async function createBackup(state: Library): Promise<File> {
  ensureDirectories();
  const entities = encodeEntities(state);
  const head = encodeMetaV2(state, entities.length, entityCount(state));
  const out = new File(
    backupDirectory,
    backupFileName(new Date(), randomUUID().slice(0, 8)),
  );
  out.create();
  const handle = out.open(FileMode.WriteOnly);
  try {
    handle.writeBytes(head);
    handle.writeBytes(entities);
    const owners = blobOwners(state);
    for (const blob of backupBlobs(state)) {
      const m = owners.get(blob.sha256)!;
      const source = mediaFile(m);
      // 文件不在或长度对不上，先给一句人话，再谈哈希。
      if (!source.exists || source.size !== blob.bytes)
        throw new Error(`素材缺失或损坏：${m.name}`);
      const input = source.open(FileMode.ReadOnly);
      // 边写边算哈希：素材只读一遍，读出来的字节就是写进去的字节。
      const digest = sha256.create();
      try {
        let remaining = blob.bytes;
        while (remaining) {
          const bytes = input.readBytes(Math.min(262144, remaining));
          if (!bytes.length) throw new Error("素材读取失败。");
          digest.update(bytes);
          handle.writeBytes(bytes);
          remaining -= bytes.length;
          await tick();
        }
      } finally {
        input.close();
      }
      if (bytesToHex(digest.digest()) !== blob.sha256)
        throw new Error(`素材缺失或损坏：${m.name}`);
    }
  } catch (e) {
    handle.close();
    out.delete();
    throw e;
  }
  handle.close();
  try {
    await verifyBackupContainer(out);
    pruneBackups(3, out);
    return out;
  } catch (e) {
    out.delete();
    throw e;
  }
}
/** 只把外壳读回来核对：魔数、清单、实体段与总长度。素材字节写的时候已经逐块核过。 */
async function verifyBackupContainer(file: File): Promise<void> {
  const h = file.open(FileMode.ReadOnly);
  try {
    const head = h.readBytes(12);
    if (!isMagic(head, BACKUP_MAGIC_V2))
      throw new Error("备份文件不完整。");
    const { meta, entities, headerBytes } = readV2Head(h, file.size, head);
    const state = decodeLibraryV2(meta, entities);
    const expected =
      headerBytes + meta.blobs.reduce((n, b) => n + b.bytes, 0);
    if (!Number.isSafeInteger(expected) || file.size !== expected)
      throw new Error("备份文件长度不完整。");
    if (entityCount(state) !== meta.entityCount)
      throw new Error("备份内容不完整。");
  } finally {
    h.close();
  }
}
type Handle = ReturnType<File["open"]>;
const isMagic = (head: Uint8Array, magic: Uint8Array) =>
  head.length === 12 && magic.every((b, i) => head[i] === b);
const headLength = (head: Uint8Array) =>
  new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(8);
/** 读 v2 外壳：meta 与实体段。返回后句柄正停在素材字节的开头。 */
function readV2Head(h: Handle, size: number, head: Uint8Array) {
  const metaBytes = headLength(head);
  if (metaBytes > META_LIMIT || metaBytes > size - 12)
    throw new Error("备份清单损坏。");
  const meta = decodeMetaV2(h.readBytes(metaBytes));
  if (meta.entityBytes > size - 12 - metaBytes)
    throw new Error("备份内容不完整。");
  const entities = h.readBytes(meta.entityBytes);
  if (entities.length !== meta.entityBytes)
    throw new Error("备份内容不完整。");
  return { meta, entities, headerBytes: 12 + metaBytes + meta.entityBytes };
}
/** 逐块读出一段字节，边读边算哈希；target 为空时只校验不落盘。 */
async function drainBlob(
  h: Handle,
  bytes: number,
  target: File | null,
  expected: string,
  name: string,
): Promise<void> {
  const digest = sha256.create();
  const output = target?.open(FileMode.WriteOnly);
  try {
    let remaining = bytes;
    while (remaining) {
      const chunk = h.readBytes(Math.min(262144, remaining));
      if (!chunk.length) throw new Error("备份素材不完整。");
      digest.update(chunk);
      output?.writeBytes(chunk);
      remaining -= chunk.length;
      await tick();
    }
  } finally {
    output?.close();
  }
  if (bytesToHex(digest.digest()) !== expected)
    throw new Error(`备份素材校验失败：${name}`);
}
async function inspectV2(
  h: Handle,
  file: File,
  head: Uint8Array,
  extract: boolean,
  written: File[],
): Promise<Library> {
  const { meta, entities, headerBytes } = readV2Head(h, file.size, head);
  const state = decodeLibraryV2(meta, entities);
  const expected = headerBytes + meta.blobs.reduce((n, b) => n + b.bytes, 0);
  if (!Number.isSafeInteger(expected) || file.size !== expected)
    throw new Error("备份文件长度不完整。");
  ensureDirectories();
  const owners = blobOwners(state);
  const extracted = new Map<string, File>();
  for (const blob of meta.blobs) {
    const owner = owners.get(blob.sha256)!;
    const target = extract
      ? new File(mediaDirectory, `${randomUUID()}.${owner.file.split(".").pop()}`)
      : null;
    if (target) {
      target.create();
      written.push(target);
      extracted.set(blob.sha256, target);
    }
    await drainBlob(h, blob.bytes, target, blob.sha256, owner.name);
  }
  if (!extract) return state;
  // 同一份字节可能被多条素材共用：第一条直接用解出来的文件，其余各复制一份，
  // 各自保有独立文件，删掉其中一条不会动到另一条。
  const taken = new Set<string>();
  for (const [id, m] of Object.entries(state.media)) {
    const source = extracted.get(m.sha256)!;
    if (!taken.has(m.sha256)) {
      taken.add(m.sha256);
      state.media[id] = { ...m, file: source.name };
      continue;
    }
    const copy = new File(
      mediaDirectory,
      `${randomUUID()}.${m.file.split(".").pop()}`,
    );
    await source.copy(copy, { overwrite: false });
    written.push(copy);
    state.media[id] = { ...m, file: copy.name };
  }
  return state;
}
/** Build 62 及更早的整库单清单格式：只读兼容，不再产出。 */
async function inspectV1(
  h: Handle,
  file: File,
  head: Uint8Array,
  extract: boolean,
  written: File[],
): Promise<Library> {
  const length = headLength(head);
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
    const m = state.media[id]!;
    const target = extract
      ? new File(mediaDirectory, `${randomUUID()}.${m.file.split(".").pop()}`)
      : null;
    if (target) {
      target.create();
      written.push(target);
    }
    await drainBlob(h, m.bytes, target, m.sha256, m.name);
    if (target) state.media[id] = { ...m, file: target.name };
  }
  return state;
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
    if (isMagic(head, BACKUP_MAGIC_V2))
      return await inspectV2(h, file, head, extract, written);
    if (isMagic(head, BACKUP_MAGIC))
      return await inspectV1(h, file, head, extract, written);
    throw new Error("请选择小美成长记 .xmb 备份文件。");
  } catch (e) {
    for (const f of written) if (f.exists) f.delete();
    throw e;
  } finally {
    h.close();
  }
}

/** 恢复的进度播报；只用于界面提示，回调抛错不影响恢复本身。 */
export type RestoreProgress = (stage: string) => void;
/** 备份不含缩略图字节；用全新随机名重建，失败清理才能只删本次恢复产生的文件。 */
async function rebuildThumbs(
  state: Library,
  onProgress?: RestoreProgress,
): Promise<void> {
  const pending = Object.entries(state.media).filter(
    ([, m]) => m.kind === "image" || m.kind === "video",
  );
  let done = 0;
  for (const [id, m] of pending) {
    const thumb = await renderThumb(m.kind, mediaUri(m), randomUUID());
    if (thumb) state.media[id] = { ...m, ...thumb };
    onProgress?.(`正在重建缩略图 ${++done}/${pending.length}`);
  }
}
/**
 * 解包、校验与重建缩略图都在写队列之外做——这几步会读写整库的素材，扣着写队列
 * 就是把界面连同自动保存一起卡住，而且没有任何进度。全部准备好之后，只用一次很短
 * 的 change 整体切换；中途任何一步失败，当前库一个字节都没动过。
 */
export async function restoreBackup(
  store: LocalStore,
  file: File,
  onProgress?: RestoreProgress,
): Promise<File> {
  onProgress?.("正在备份当前内容…");
  const prior = await createBackup(store.get());
  let restored: Library | null = null;
  try {
    onProgress?.("正在校验并解包备份…");
    restored = await inspectBackup(file, true);
    await rebuildThumbs(restored, onProgress);
    onProgress?.("正在写入本机资料…");
    const next = restored;
    await store.change((current) => {
      Object.assign(current, next);
    });
  } catch (e) {
    if (restored)
      for (const m of Object.values(restored.media)) deleteMediaFiles(m);
    throw e;
  }
  return prior;
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
export async function recoverStartupBackup(
  file: File,
  onProgress?: RestoreProgress,
): Promise<void> {
  const restored = await inspectBackup(file, true);
  await rebuildThumbs(restored, onProgress);
  try {
    const { activateRecoveredLibrary } = await import("./activation");
    await activateRecoveredLibrary(restored);
  } catch (e) {
    for (const media of Object.values(restored.media)) deleteMediaFiles(media);
    throw e;
  }
}
