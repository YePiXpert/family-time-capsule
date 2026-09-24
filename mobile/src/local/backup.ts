import { Directory, File, FileMode, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as Sharing from "expo-sharing";
import { APP_NAME, BACKUP_PREFIX } from "./brand";
import {
  READ_INCOMPLETE,
  backupDirectory,
  blobDirectory,
  blobFile,
  blobPartFile,
  blobPrefixDirectory,
  deleteMediaFiles,
  ensureDirectories,
  mediaDirectory,
  mediaFile,
  mediaUri,
  pumpBytes,
  renderThumb,
  syncDirectory,
  syncManifestFile,
  type FileHandle,
} from "./files";
import {
  BACKUP_MAGIC,
  BACKUP_MAGIC_V2,
  BACKUP_MAGIC_V3,
  HEADER_LIMIT,
  META_LIMIT,
  backupBlobs,
  decodeLibraryV2,
  decodeMetaV2,
  decodeManifest,
  encodeEntities,
  encodeMetaV2,
  type BackupBlob,
  type BackupMetaV2,
} from "./backup-format";
import {
  ENTITY_KINDS,
  clone,
  type Library,
  type LocalMedia,
  type Stored,
} from "./model";
import type { LocalStore } from "./store";
/** 进度播报；只用于界面提示，回调抛错不影响备份或恢复本身。 */
export type RestoreProgress = (stage: string) => void;
export class BackupStopped extends Error {
  constructor() {
    super("已停止。");
    this.name = "BackupStopped";
  }
}
const stampOf = (at: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
};
/** 名字里的 YYYYMMDD-HHMM 段就是创建顺序；前缀改过名，所以不能拿整个文件名比大小。 */
export function backupFileName(at: Date, id: string, ext = "xmb"): string {
  return `${BACKUP_PREFIX}-${stampOf(at)}-${id}.${ext}`;
}
/**
 * 远端恢复进行中的「钉子」：清单先以这个名字落地，blob 回收就认得下载到一半的照片是有人要的，
 * 中断后再来才真是续传。它不算保留备份（列表、启动救援、保留位都不认它），七天没动就当废弃清掉。
 */
export const restorePinName = (at: Date, id: string) =>
  `restoring-${stampOf(at)}-${id}.xmbm.part`;
const isRestorePin = (name: string) => /^restoring-.*\.xmbm\.part$/.test(name);
const PIN_TTL_MS = 7 * 86400000;
/** 清单写入只需片刻；留一小时余量保护正在写的半成品，崩溃残片不必占七天。 */
const MANIFEST_PART_TTL_MS = 3600000;
/** 素材进 blob 库之外还要给系统留的余量。 */
const BLOB_MARGIN = 64 * 1024 * 1024;
/** 保留备份在页面上的名字：「9月19日 15:44」，跨年带年份；名字里读不出时间戳时返回 null。 */
export function backupStampLabel(
  name: string,
  today = new Date(),
): string | null {
  const m = name.match(/-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})-/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const day = `${Number(mo)}月${Number(d)}日 ${h}:${mi}`;
  return Number(y) === today.getFullYear() ? day : `${y}年${day}`;
}
/** 备份名里的时间戳；取不到的（外部改过名的文件）排到最后。 */
const backupStamp = (name: string) => name.match(/-(\d{8}-\d{4})-/)?.[1] ?? "";
/** 应用内保留的备份：Build 70 起是 .xmbm 清单备份，之前是整份 .xmb；两种都认。 */
export const isRetainedBackup = (name: string) => /\.xmbm?$/.test(name);
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
  // 两个本地零点相差的是整天数，但跨夏令时那天只有 23 小时：取整而不是向下取，免得少算一天。
  return Math.round((start(today) - start(exported)) / 86400000);
}
/** 应用内保留的备份，最新的在前。 */
export function retainedBackups(): File[] {
  if (!backupDirectory.exists) return [];
  return backupDirectory
    .list()
    .filter((f): f is File => f instanceof File && isRetainedBackup(f.name))
    .sort(
      (a, b) =>
        backupStamp(b.name).localeCompare(backupStamp(a.name)) ||
        b.name.localeCompare(a.name),
    );
}
/** 远端恢复留下的钉子（见 restorePinName）。 */
export function restorePins(): File[] {
  if (!backupDirectory.exists) return [];
  return backupDirectory
    .list()
    .filter((f): f is File => f instanceof File && isRestorePin(f.name));
}
/**
 * Keeps only the newest local retention copies; exports outside the app are untouched.
 * protect 的第一份是刚创建的那份，占一个保留位；其余（正要恢复的）只是这一轮不动。
 */
export function pruneBackups(keep = 3, protect: File | File[] = []): void {
  const shielded = new Set(
    (Array.isArray(protect) ? protect : [protect]).map((f) => f.uri),
  );
  const others = retainedBackups().filter((f) => !shielded.has(f.uri));
  // 同一分钟内名字的字典序不等于创建顺序，因此给刚创建的这份预留一个保留位，
  // 再按名字清掉最旧的其余备份。
  const doomed = shielded.size ? others.slice(keep - 1) : others.slice(keep);
  for (const file of doomed) if (file.exists) file.delete();
  // 七天前的钉子：那次远端恢复没有再继续，别让它永远护着一堆没人要的 blob。
  const cutoff = stampOf(new Date(Date.now() - PIN_TTL_MS));
  for (const pin of restorePins())
    if (backupStamp(pin.name) < cutoff && pin.exists) pin.delete();
  const partCutoff = stampOf(new Date(Date.now() - MANIFEST_PART_TTL_MS));
  if (backupDirectory.exists)
    for (const file of backupDirectory.list()) {
      if (
        !(file instanceof File) || file.name.startsWith("restoring-") ||
        !file.name.endsWith(".xmbm.part") || shielded.has(file.uri)
      ) continue;
      const stamp = backupStamp(file.name);
      if (stamp && stamp < partCutoff && file.exists) file.delete();
    }
}
const entityCount = (state: Library) =>
  ENTITY_KINDS.reduce((n, kind) => n + Object.keys(state[kind]).length, 0);
/** 每个 sha256 取一条代表素材：同一张照片存了两次，备份里也只写一份字节。 */
export function blobOwners(state: Library): Map<string, Stored<LocalMedia>> {
  const owners = new Map<string, Stored<LocalMedia>>();
  for (const id of Object.keys(state.media).sort()) {
    const m = state.media[id]!;
    if (!owners.has(m.sha256)) owners.set(m.sha256, m);
  }
  return owners;
}
type Handle = FileHandle;
/**
 * 把一份素材放进 blob 库：已经有一份且长度对就跳过；否则从素材原件分块复制到 .part，
 * 长度与 sha256 都核对过才换成正式名字。返回是否真的写了。
 */
export async function ensureBlob(
  m: Pick<LocalMedia, "name" | "file">,
  blob: BackupBlob,
): Promise<boolean> {
  const target = blobFile(blob.sha256);
  if (target.exists && target.size === blob.bytes) return false;
  const source = mediaFile(m as LocalMedia);
  // 文件不在或长度对不上，先给一句人话，再谈哈希。
  if (!source.exists || source.size !== blob.bytes)
    throw new Error(`素材缺失或损坏：${m.name}`);
  blobPrefixDirectory(blob.sha256).create({
    intermediates: true,
    idempotent: true,
  });
  const part = blobPartFile(blob.sha256);
  if (part.exists) part.delete();
  part.create();
  try {
    const input = source.open(FileMode.ReadOnly);
    let output: Handle;
    try {
      output = part.open(FileMode.WriteOnly);
    } catch (e) {
      input.close();
      throw e;
    }
    let hash: string;
    try {
      hash = await pumpBytes(input, blob.bytes, output);
    } finally {
      output.close();
      input.close();
    }
    if (hash !== blob.sha256) throw new Error(`素材缺失或损坏：${m.name}`);
    if (target.exists) target.delete();
    await part.move(target, { overwrite: false });
    return true;
  } catch (e) {
    if (part.exists) part.delete();
    throw e;
  }
}
/**
 * 保留备份（.xmbm）：素材进 blob 库（已有的跳过），再写一份只含清单与实体的小文件。
 * 三份保留备份只占一份照片的空间；写完读回核对，最后清掉没人引用的 blob。
 */
export async function createBackup(
  state: Library,
  onProgress?: RestoreProgress,
  signal?: AbortSignal,
): Promise<File> {
  return writeManifest(state, onProgress, signal);
}
/** createBackup 的本体；protect 里的保留备份这一轮不清（恢复时先备份当前内容，不能把正要恢复的那份清掉）。 */
async function writeManifest(
  state: Library,
  onProgress?: RestoreProgress,
  signal?: AbortSignal,
  protect: File[] = [],
): Promise<File> {
  const out = new File(
    backupDirectory,
    backupFileName(new Date(), randomUUID().slice(0, 8), "xmbm"),
  );
  await writeManifestTo(state, out, backupDirectory, false, onProgress, signal);
  // 收拾失败不影响已经写好、核对过的备份。
  tidyBackups([out, ...protect]);
  return out;
}
/**
 * 录到一半的录音是这台手机上的临时文件，不属于库：草稿照备，只是不带它。
 * 否则应用在录音中被杀、那份草稿又没再打开，之后每次备份与家人同步都会被拦下；
 * 家人同步判断「这次跟上次上传的一样」也要用同一份去掉它的库。
 */
export function withoutPendingRecordings(state: Library): Library {
  const pending = Object.values(state.drafts).filter((d) => d.recordingFile);
  if (!pending.length) return state;
  const drafts = { ...state.drafts };
  for (const d of pending) {
    const { recordingFile: _pending, ...rest } = d;
    drafts[d.id] = rest;
  }
  return { ...state, drafts };
}
/** 家人同步只留一份独立清单，不进入保留备份列表，也不挤占三份保留位。 */
export async function createSyncManifest(
  state: Library,
  onProgress?: RestoreProgress,
  signal?: AbortSignal,
): Promise<File> {
  syncDirectory.create({ intermediates: true, idempotent: true });
  const out = syncManifestFile();
  await writeManifestTo(state, out, syncDirectory, true, onProgress, signal);
  try {
    collectBlobs();
  } catch {
    // 清单已经完成，回收失败留到下次再试。
  }
  return out;
}
/** 两种清单共用素材入库、实体编码、半成品写入与读回校验。 */
async function writeManifestTo(
  state: Library,
  out: File,
  directory: Directory,
  overwrite: boolean,
  onProgress?: RestoreProgress,
  signal?: AbortSignal,
): Promise<void> {
  ensureDirectories();
  state = withoutPendingRecordings(state);
  const entities = encodeEntities(state);
  const head = encodeMetaV2(state, entities.length, entityCount(state), {
    magic: BACKUP_MAGIC_V3,
  });
  const owners = blobOwners(state);
  const blobs = backupBlobs(state);
  // 第一次做清单备份要把整个素材库复制一份进 blob 库：空间不够先说清楚，一个字节都不写。
  assertBlobSpace(
    blobs.reduce((n, blob) => {
      const stored = blobFile(blob.sha256);
      return stored.exists && stored.size === blob.bytes ? n : n + blob.bytes;
    }, 0),
  );
  let done = 0;
  for (const blob of blobs) {
    if (signal?.aborted) throw new BackupStopped();
    await ensureBlob(owners.get(blob.sha256)!, blob);
    onProgress?.(`正在整理照片 ${++done}/${blobs.length}`);
  }
  // 被系统中断时只留下半成品，不进入保留列表，也不阻塞 blob 回收。
  const part = new File(directory, `${out.name}.part`);
  try {
    if (overwrite && part.exists) part.delete();
    part.create();
    const handle = part.open(FileMode.WriteOnly);
    try {
      handle.writeBytes(head);
      handle.writeBytes(entities);
    } finally {
      handle.close();
    }
    await verifyManifest(part);
    await part.move(out, { overwrite });
  } catch (e) {
    if (part.exists) part.delete();
    throw e;
  }
}
/** 清旧份 + 回收 blob；失败吞掉——备份或恢复本身已经完成，下次再收拾。 */
function tidyBackups(protect: File[]): void {
  try {
    pruneBackups(3, protect);
    collectBlobs();
  } catch {
    // 下一次备份会再来一遍。
  }
}
/** 素材进 blob 库前的空间预检：查不到剩余空间就放行。 */
function assertBlobSpace(bytes: number): void {
  if (!bytes) return;
  const free = Paths.availableDiskSpace;
  if (Number.isFinite(free) && free < bytes + BLOB_MARGIN)
    throw new Error(
      `本机空间不足：把照片整理进备份库还需要约 ${Math.ceil((bytes + BLOB_MARGIN) / 1048576)} MB，请先清理一些空间再备份。`,
    );
}
const isMagic = (head: Uint8Array, magic: Uint8Array) =>
  head.length === 12 && magic.every((b, i) => head[i] === b);
const headLength = (head: Uint8Array) =>
  new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(8);
/** 读 v2／v3 外壳：meta 与实体段。返回后句柄正停在素材字节的开头。 */
function readV2Head(h: Handle, size: number, head: Uint8Array) {
  const metaBytes = headLength(head);
  if (metaBytes > META_LIMIT || metaBytes > size - 12)
    throw new Error("备份清单损坏。");
  const meta = decodeMetaV2(h.readBytes(metaBytes));
  if (meta.entityBytes > size - 12 - metaBytes)
    throw new Error("备份内容不完整。");
  // 全新的库一条实体都没有，这一段长度就是 0：别去读 0 字节，各平台的行为不一样。
  const entities = meta.entityBytes
    ? h.readBytes(meta.entityBytes)
    : new Uint8Array(0);
  if (entities.length !== meta.entityBytes) throw new Error("备份内容不完整。");
  return { meta, entities, headerBytes: 12 + metaBytes + meta.entityBytes };
}
/** 只读魔数与 meta（不读实体段）：列表、回收与分卷校验都只需要这些。 */
function peekMeta(file: File): {
  magic: Uint8Array;
  meta: BackupMetaV2;
  metaBytes: number;
} {
  const h = file.open(FileMode.ReadOnly);
  try {
    const head = h.readBytes(12);
    const magic = isMagic(head, BACKUP_MAGIC_V3)
      ? BACKUP_MAGIC_V3
      : isMagic(head, BACKUP_MAGIC_V2)
        ? BACKUP_MAGIC_V2
        : null;
    if (!magic) throw new Error(`请选择${APP_NAME} .xmb 备份文件。`);
    const metaBytes = headLength(head);
    if (metaBytes > META_LIMIT || metaBytes > file.size - 12)
      throw new Error("备份清单损坏。");
    return { magic, meta: decodeMetaV2(h.readBytes(metaBytes)), metaBytes };
  } finally {
    h.close();
  }
}
/** 读出一份清单备份（.xmbm）的 meta 与实体段；外壳不是清单备份或长度不对就报错。 */
export function readManifest(file: File): {
  meta: BackupMetaV2;
  entities: Uint8Array;
} {
  if (!file.exists || file.size < 12) throw new Error("备份文件不完整。");
  const h = file.open(FileMode.ReadOnly);
  try {
    const head = h.readBytes(12);
    if (!isMagic(head, BACKUP_MAGIC_V3)) throw new Error("备份文件不完整。");
    const { meta, entities, headerBytes } = readV2Head(h, file.size, head);
    if (file.size !== headerBytes) throw new Error("备份文件长度不完整。");
    return { meta, entities };
  } finally {
    h.close();
  }
}
/** 清单备份写完后读回核对：外壳完整、库能通过校验、每个 blob 都在库里且长度对。 */
async function verifyManifest(file: File): Promise<void> {
  const { meta, entities } = readManifest(file);
  const state = decodeLibraryV2(meta, entities);
  if (entityCount(state) !== meta.entityCount)
    throw new Error("备份内容不完整。");
  for (const blob of meta.blobs) {
    const stored = blobFile(blob.sha256);
    if (!stored.exists || stored.size !== blob.bytes)
      throw new Error("备份里的照片没有完整落盘，请重试。");
  }
}
/**
 * 把 blob 库里的一份素材逐块写进 output，边写边核对哈希：导出分卷与远端上传都走这里。
 * 不在库里、长度或哈希不对都整份失败。
 */
export async function streamBlob(
  blob: BackupBlob,
  output: Handle,
  name: string,
  onChunk?: (chunk: Uint8Array) => void,
  signal?: AbortSignal,
): Promise<void> {
  const stored = blobFile(blob.sha256);
  if (!stored.exists || stored.size !== blob.bytes)
    throw new Error(`备份里的照片已不在本机：${name}`);
  const input = stored.open(FileMode.ReadOnly);
  let hash: string;
  try {
    hash = await pumpBytes(input, blob.bytes, output, (chunk) => {
      // 停止要到块：一段几 GB 的视频不能在按下停止后还整个写完。
      if (signal?.aborted) throw new BackupStopped();
      onChunk?.(chunk);
    });
  } catch (e) {
    // 只有源文件读不满才是备份坏了；目标写不进去（多半是空间不足）要原样说，别把好备份说成坏的。
    if (e instanceof Error && e.message === READ_INCOMPLETE)
      throw new Error("备份素材不完整。");
    throw e;
  } finally {
    input.close();
  }
  if (hash !== blob.sha256) throw new Error(`备份素材校验失败：${name}`);
}
/** 一份清单备份引用的 blob；读不出来返回 null，让回收知道该收手。 */
export function manifestBlobs(file: File): BackupBlob[] | null {
  try {
    const { magic, meta } = peekMeta(file);
    return magic === BACKUP_MAGIC_V3 ? meta.blobs : null;
  } catch {
    return null;
  }
}
/**
 * 回收 blob 库：保留集 = 所有清单备份引用的 blob 的并集；不在集合里的 blob 与所有 .part 删掉。
 * 任何一份清单读不出来就这一轮不删（返回 null）——宁可多占空间，不可删掉还有人要的字节。
 */
export function collectBlobs(): { removed: number; bytes: number } | null {
  if (!blobDirectory.exists) return { removed: 0, bytes: 0 };
  const keep = new Set<string>();
  for (const file of retainedBackups()) {
    if (!file.name.endsWith(".xmbm")) continue;
    const blobs = manifestBlobs(file);
    if (!blobs) return null;
    for (const blob of blobs) keep.add(blob.sha256);
  }
  // 独立同步清单与远端恢复的钉子也护住 blob；读不出的文件直接清掉。
  const syncManifest = syncManifestFile();
  for (const pin of [
    ...restorePins(),
    ...(syncManifest.exists ? [syncManifest] : []),
  ]) {
    const blobs = manifestBlobs(pin);
    if (!blobs) {
      pin.delete();
      continue;
    }
    for (const blob of blobs) keep.add(blob.sha256);
  }
  let removed = 0,
    bytes = 0;
  for (const prefix of blobDirectory.list()) {
    if (!(prefix instanceof Directory)) continue;
    for (const entry of prefix.list()) {
      if (!(entry instanceof File)) continue;
      if (/^[a-f0-9]{64}$/.test(entry.name) && keep.has(entry.name)) continue;
      bytes += entry.size;
      entry.delete();
      removed++;
    }
  }
  return { removed, bytes };
}
export type LocalBackup = {
  file: File;
  /** 「9月19日 15:44」；外部改过名的文件为 null。 */
  label: string | null;
  /** 这份备份实际代表的字节数：清单备份 = 文件 + 它引用的 blob。 */
  bytes: number;
  manifestOnly: boolean;
};
/** 给备份页的列表：最新在前。 */
export function listLocalBackups(): LocalBackup[] {
  return retainedBackups().map((file) => {
    const manifestOnly = file.name.endsWith(".xmbm");
    const blobs = manifestOnly ? manifestBlobs(file) : null;
    return {
      file,
      label: backupStampLabel(file.name),
      bytes: file.size + (blobs?.reduce((n, b) => n + b.bytes, 0) ?? 0),
      manifestOnly,
    };
  });
}
/** 逐块读出一段字节，边读边算哈希；target 为空时只校验不落盘。 */
async function drainBlob(
  h: Handle,
  bytes: number,
  target: File | null,
  expected: string,
  name: string,
  signal?: AbortSignal,
): Promise<void> {
  const output = target?.open(FileMode.WriteOnly) ?? null;
  let hash: string;
  try {
    hash = await pumpBytes(h, bytes, output, () => {
      if (signal?.aborted) throw new BackupStopped();
    });
  } catch (e) {
    if (e instanceof Error && e.message === READ_INCOMPLETE)
      throw new Error("备份素材不完整。");
    throw e;
  } finally {
    output?.close();
  }
  if (hash !== expected) throw new Error(`备份素材校验失败：${name}`);
}
const extractTarget = (m: Pick<LocalMedia, "file">) =>
  new File(mediaDirectory, `${randomUUID()}.${m.file.split(".").pop()}`);
/**
 * 同一份字节可能被多条素材共用：第一条直接用解出来的文件，其余各复制一份，
 * 各自保有独立文件，删掉其中一条不会动到另一条。
 */
async function assignExtracted(
  state: Library,
  extracted: Map<string, File>,
  written: File[],
): Promise<void> {
  const taken = new Set<string>();
  for (const [id, m] of Object.entries(state.media)) {
    // 旧缩略图可能仍被当前库使用；本次恢复只认随后重建出的新名字。
    const restored = { ...m, thumb: undefined };
    const source = extracted.get(m.sha256)!;
    if (!taken.has(m.sha256)) {
      taken.add(m.sha256);
      state.media[id] = { ...restored, file: source.name };
      continue;
    }
    const copy = extractTarget(m);
    // 先登记再复制：复制到一半失败，清理时才找得到这个半成品。
    written.push(copy);
    await source.copy(copy, { overwrite: false });
    state.media[id] = { ...restored, file: copy.name };
  }
}
/** 清单备份（.xmbm）：素材从本机 blob 库取，缺一份、错一字节都整份失败。 */
async function inspectManifest(
  h: Handle,
  file: File,
  head: Uint8Array,
  extract: boolean,
  written: File[],
  signal?: AbortSignal,
): Promise<Library> {
  const { meta, entities, headerBytes } = readV2Head(h, file.size, head);
  const state = decodeLibraryV2(meta, entities);
  if (file.size !== headerBytes) throw new Error("备份文件长度不完整。");
  ensureDirectories();
  const owners = blobOwners(state);
  const extracted = new Map<string, File>();
  for (const blob of meta.blobs) {
    if (signal?.aborted) throw new BackupStopped();
    const owner = owners.get(blob.sha256)!;
    const stored = blobFile(blob.sha256);
    if (!stored.exists || stored.size !== blob.bytes)
      throw new Error(`备份里的照片已不在本机：${owner.name}`);
    const target = extract ? extractTarget(owner) : null;
    if (target) {
      target.create();
      written.push(target);
      extracted.set(blob.sha256, target);
    }
    const input = stored.open(FileMode.ReadOnly);
    try {
      await drainBlob(
        input,
        blob.bytes,
        target,
        blob.sha256,
        owner.name,
        signal,
      );
    } finally {
      input.close();
    }
  }
  if (extract) await assignExtracted(state, extracted, written);
  return state;
}
type VolumeHead = { file: File; meta: BackupMetaV2; metaBytes: number };
/** 分卷一致性：同一个 set、卷数对、每卷各一份、区间首尾相接盖住全部 blobs。 */
function orderVolumes(heads: VolumeHead[]): VolumeHead[] {
  const first = heads[0]!.meta;
  const set = first.set;
  if (!set) {
    if (heads.length > 1) throw new Error("这几份不是同一份备份的分卷。");
    return heads;
  }
  if (heads.some((v) => v.meta.set?.id !== set.id))
    throw new Error("这几卷不是同一份备份。");
  if (
    heads.some(
      (v) =>
        v.meta.set!.count !== set.count ||
        v.meta.createdAt !== first.createdAt ||
        v.meta.entityBytes !== first.entityBytes ||
        v.meta.entityCount !== first.entityCount ||
        JSON.stringify(v.meta.blobs) !== JSON.stringify(first.blobs),
    )
  )
    throw new Error("这几卷不是同一份备份。");
  const seen = new Set<number>();
  for (const v of heads) {
    if (seen.has(v.meta.set!.index)) throw new Error("同一卷选了两次。");
    seen.add(v.meta.set!.index);
  }
  for (let i = 0; i < set.count; i++)
    if (!seen.has(i))
      throw new Error(`还缺第 ${i + 1} 卷（共 ${set.count} 卷），请一起选中。`);
  const ordered = [...heads].sort(
    (a, b) => a.meta.set!.index - b.meta.set!.index,
  );
  let next = 0;
  for (const v of ordered) {
    if (v.meta.set!.from !== next) throw new Error("这几卷不是同一份备份。");
    next += v.meta.set!.take;
  }
  if (next !== first.blobs.length) throw new Error("这几卷不是同一份备份。");
  return ordered;
}
/** v2 整份备份，一卷或多卷：清单来自第一卷，素材按卷顺序逐块读出。 */
async function inspectVolumes(
  ordered: VolumeHead[],
  extract: boolean,
  written: File[],
  signal?: AbortSignal,
): Promise<Library> {
  let state: Library | null = null;
  let entityHash: string | null = null;
  const extracted = new Map<string, File>();
  let owners: Map<string, Stored<LocalMedia>> | null = null;
  for (const volume of ordered) {
    const h = volume.file.open(FileMode.ReadOnly);
    try {
      const head = h.readBytes(12);
      const { meta, entities, headerBytes } = readV2Head(
        h,
        volume.file.size,
        head,
      );
      const hash = bytesToHex(sha256(entities));
      if (!state) {
        state = decodeLibraryV2(meta, entities);
        entityHash = hash;
        ensureDirectories();
        owners = blobOwners(state);
      } else if (hash !== entityHash) throw new Error("这几卷不是同一份备份。");
      const from = meta.set?.from ?? 0,
        take = meta.set?.take ?? meta.blobs.length;
      const slice = meta.blobs.slice(from, from + take);
      const expected = headerBytes + slice.reduce((n, b) => n + b.bytes, 0);
      if (!Number.isSafeInteger(expected) || volume.file.size !== expected)
        throw new Error("备份文件长度不完整。");
      for (const blob of slice) {
        if (signal?.aborted) throw new BackupStopped();
        const owner = owners!.get(blob.sha256)!;
        const target = extract ? extractTarget(owner) : null;
        if (target) {
          target.create();
          written.push(target);
          extracted.set(blob.sha256, target);
        }
        await drainBlob(h, blob.bytes, target, blob.sha256, owner.name, signal);
      }
    } finally {
      h.close();
    }
  }
  if (extract) await assignExtracted(state!, extracted, written);
  return state!;
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
    const target = extract ? extractTarget(m) : null;
    if (target) {
      target.create();
      written.push(target);
    }
    await drainBlob(h, m.bytes, target, m.sha256, m.name);
    // 旧版备份同样不能把当前库仍在用的缩略图带入恢复失败的清理范围。
    if (target) state.media[id] = { ...m, file: target.name, thumb: undefined };
  }
  return state;
}
/**
 * Verify the complete stream, not just its filename or JSON. Optional extraction is isolated.
 * 传一个文件：清单备份、整份 .xmb、旧版单清单都认；传多个文件：必须是同一份备份的全部分卷。
 */
export async function inspectBackup(
  input: File | File[],
  extract = false,
  signal?: AbortSignal,
): Promise<Library> {
  const files = Array.isArray(input) ? input : [input];
  if (!files.length) throw new Error("请选择备份文件。");
  for (const file of files)
    if (!file.exists || file.size < 12) throw new Error("备份文件不完整。");
  const written: File[] = [];
  try {
    if (files.length === 1) {
      const file = files[0]!;
      const h = file.open(FileMode.ReadOnly);
      try {
        const head = h.readBytes(12);
        if (isMagic(head, BACKUP_MAGIC_V3))
          return await inspectManifest(h, file, head, extract, written, signal);
        if (isMagic(head, BACKUP_MAGIC))
          return await inspectV1(h, file, head, extract, written);
        if (!isMagic(head, BACKUP_MAGIC_V2))
          throw new Error(`请选择${APP_NAME} .xmb 备份文件。`);
      } finally {
        h.close();
      }
    }
    const heads = files.map((file) => {
      const { magic, meta, metaBytes } = peekMeta(file);
      if (magic !== BACKUP_MAGIC_V2)
        throw new Error("请一次只恢复一份备份：多选时只能是同一份备份的分卷。");
      return { file, meta, metaBytes };
    });
    const set = heads[0]!.meta.set;
    if (heads.length === 1 && set && set.count > 1)
      throw new Error(
        `这份备份有 ${set.count} 卷，请一起选中全部 ${set.count} 卷。`,
      );
    const ordered = orderVolumes(heads);
    // 每一卷的长度先一起核对：第三卷被截断，不该等前两卷几个 GB 都解完了才发现。
    for (const volume of ordered) {
      const from = volume.meta.set?.from ?? 0,
        take = volume.meta.set?.take ?? volume.meta.blobs.length;
      const expected =
        12 +
        volume.metaBytes +
        volume.meta.entityBytes +
        volume.meta.blobs
          .slice(from, from + take)
          .reduce((n, b) => n + b.bytes, 0);
      if (!Number.isSafeInteger(expected) || volume.file.size !== expected)
        throw new Error("备份文件长度不完整。");
    }
    return await inspectVolumes(ordered, extract, written, signal);
  } catch (e) {
    for (const f of written) if (f.exists) f.delete();
    throw e;
  }
}
/** 备份不含缩略图字节；用全新随机名重建，失败清理才能只删本次恢复产生的文件。 */
async function rebuildThumbs(
  state: Library,
  onProgress?: RestoreProgress,
  signal?: AbortSignal,
): Promise<void> {
  const pending = Object.entries(state.media).filter(
    ([, m]) => m.kind === "image" || m.kind === "video",
  );
  let done = 0;
  for (const [id, m] of pending) {
    if (signal?.aborted) throw new BackupStopped();
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
  input: File | File[],
  onProgress?: RestoreProgress,
  signal?: AbortSignal,
): Promise<File> {
  const inputs = Array.isArray(input) ? input : [input];
  onProgress?.("正在备份当前内容…");
  // 正要恢复的那份可能就是最旧的保留备份：先保护它不被清掉，恢复完再按常规收拾。
  const prior = await writeManifest(store.get(), onProgress, signal, inputs);
  let restored: Library | null = null;
  let replaced: LocalMedia[] = [];
  try {
    onProgress?.("正在校验并解包备份…");
    restored = await inspectBackup(inputs, true, signal);
    await rebuildThumbs(restored, onProgress, signal);
    onProgress?.("正在写入本机资料…");
    const next = restored;
    await store.change((current) => {
      replaced = Object.values(current.media);
      // 整库换成备份那一份：备份里没有的可选根字段（墓碑、上次导出时刻、提醒沉默期…）
      // 不能留着恢复前的值——留下的墓碑会让下次同步把刚恢复的记录再删一遍。
      for (const key of Object.keys(current))
        if (!Object.hasOwn(next, key))
          delete (current as Partial<Record<string, unknown>>)[key];
      Object.assign(current, next);
    });
  } catch (e) {
    if (restored)
      for (const m of Object.values(restored.media)) deleteMediaFiles(m);
    throw e;
  }
  // 恢复出来的素材都是新文件名，恢复前的原件与缩略图从此没人引用（「恢复前」那份备份里有副本），
  // 不删就每恢复一次多占一整份照片的空间，「清理没用到的」也够不着它们。
  const kept = new Set(Object.values(restored.media).map((m) => m.file));
  for (const m of replaced)
    if (!kept.has(m.file))
      try {
        deleteMediaFiles(m);
      } catch {
        // 删不掉只是多占空间，恢复已经完成。
      }
  // 恢复完按常规只留三份；刚写的「恢复前」那份占一个位，最旧的让位。收拾出错不影响已完成的恢复。
  tidyBackups([prior]);
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
  input: File | File[],
  onProgress?: RestoreProgress,
): Promise<void> {
  const restored = await inspectBackup(input, true);
  try {
    await rebuildThumbs(restored, onProgress);
    const { activateRecoveredLibrary } = await import("./activation");
    await activateRecoveredLibrary(restored);
  } catch (e) {
    for (const media of Object.values(restored.media)) deleteMediaFiles(media);
    throw e;
  }
}
