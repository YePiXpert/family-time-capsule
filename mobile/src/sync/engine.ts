import { File, FileMode } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  BACKUP_MAGIC_V3,
  META_LIMIT,
  decodeLibraryV2,
  decodeMetaV2,
  type BackupMetaV2,
} from "../local/backup-format";
import {
  backupFileName,
  blobOwners,
  createBackup,
  readManifest,
  type RestoreProgress,
} from "../local/backup";
import {
  CHUNK,
  backupDirectory,
  blobFile,
  blobPartFile,
  blobPrefixDirectory,
  ensureDirectories,
  hashFile,
  type FileHandle,
} from "../local/files";
import type { Library } from "../local/model";
import {
  fromBase64,
  keyIdOf,
  objectIdOf,
  openObject,
  openSmall,
  sealObject,
  sealSmall,
  sha256Hex,
  toBase64,
} from "./crypto";
import {
  chunkSizes,
  objectsOf,
  pendingOf,
  planUpload,
  type ObjectPlan,
  type UploadItem,
} from "./planner";
import { writeRemoteState, type RemoteState } from "./state";
import { SyncError, type Transport } from "./transport";
/**
 * 远端备份引擎：本机清单备份（.xmbm + blob 库）是源头，远端只是它的密文副本。
 * 备份 = 写本机清单 → 规划对象 → 问远端缺哪些 → 只传缺的 → 传清单对象与索引 → 收拾多余对象。
 * 恢复 = 取索引 → 取清单 → 缺的 blob 逐个下载解密写进 blob 库 → 写一份 .xmbm，交给现有的本机恢复。
 * 中途失败不回滚远端：已传上去的对象下次 have 时自然续上。
 */
export const INDEX_LABEL = "anan-index-v1";
/** 清单索引明文：不到 1 KiB，服务端只见它的密文与 keyId。 */
export type RemoteIndex = {
  v: 1;
  /** 清单（.xmbm 全文）的 sha256、长度与对象数。 */
  sha256: string;
  bytes: number;
  parts: number;
  createdAt: string;
  blobs: number;
  blobBytes: number;
};
export type EngineDeps = {
  transport: Transport;
  key: Uint8Array;
  onProgress?: RestoreProgress;
  signal?: AbortSignal;
};
export type RemoteSummary = {
  createdAt: string;
  objects: number;
  bytes: number;
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const utf8 = (text: string) => new TextEncoder().encode(text);
const stopped = () => new SyncError("CANCELED", "已停止。");
const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw stopped();
};
const KEY_MISMATCH =
  "服务上已有另一份恢复码的备份。要换成这台手机的，先关闭并删除远端备份；要拿回那份，请用它的恢复码恢复。";
const WRONG_CODE = "这份恢复码打不开远端的备份，请核对后再试。";
/** 从句柄顺序读满 bytes 字节（256 KiB 一口，每口让出主线程）。 */
async function readExact(h: FileHandle, bytes: number): Promise<Uint8Array> {
  const out = new Uint8Array(bytes);
  let at = 0;
  while (at < bytes) {
    const piece = h.readBytes(Math.min(CHUNK, bytes - at));
    if (!piece.length) throw new Error("文件读取不完整。");
    out.set(piece, at);
    at += piece.length;
    await tick();
  }
  return out;
}
/**
 * 把一份内容（素材或清单）中远端缺的对象逐个封好传上去。文件只顺序读一遍：
 * 远端已有的部分读过去就丢，缺的部分拼成 1 MiB 块封成对象。
 */
async function uploadContent(
  file: File,
  plans: readonly UploadItem[],
  missing: Set<string>,
  deps: EngineDeps,
  uploaded: () => void,
): Promise<void> {
  const h = file.open(FileMode.ReadOnly);
  try {
    for (const plan of plans) {
      const sizes = chunkSizes(plan.bytes);
      if (!missing.has(plan.id)) {
        for (const size of sizes) await readExact(h, size);
        continue;
      }
      const chunks: Uint8Array[] = [];
      for (const size of sizes) chunks.push(await readExact(h, size));
      throwIfAborted(deps.signal);
      const sealed = sealObject(deps.key, plan, chunks);
      await deps.transport.put(plan.id, sealed, sha256Hex(sealed), deps.signal);
      uploaded();
    }
  } finally {
    h.close();
  }
}
const idOf = (key: Uint8Array) => (sha256: string, part: number) =>
  objectIdOf(key, sha256, part);
const withIds = (key: Uint8Array, plans: ObjectPlan[]): UploadItem[] =>
  plans.map((plan) => ({
    ...plan,
    id: objectIdOf(key, plan.sha256, plan.part),
  }));
const blobBytesOf = (meta: BackupMetaV2) =>
  meta.blobs.reduce((n, blob) => n + blob.bytes, 0);
/** 先问远端是谁的备份：另一把钥匙的备份在，就不能往上叠。 */
async function assertSameKey(deps: EngineDeps): Promise<string> {
  const keyId = keyIdOf(deps.key);
  const status = await deps.transport.status(deps.signal);
  if (status.keyId && status.keyId !== keyId)
    throw new SyncError("KEY_MISMATCH", KEY_MISMATCH);
  return keyId;
}
export async function runRemoteBackup(
  state: Library,
  deps: EngineDeps,
): Promise<RemoteState> {
  const keyId = await assertSameKey(deps);
  deps.onProgress?.("正在整理照片…");
  const manifest = await createBackup(state, deps.onProgress, deps.signal);
  const { meta, entities } = readManifest(manifest);
  const owners = blobOwners(decodeLibraryV2(meta, entities));
  const manifestSha = await hashFile(manifest);
  const manifestBytes = manifest.size;
  const blobItems = planUpload(meta.blobs, idOf(deps.key));
  const manifestItems = withIds(
    deps.key,
    objectsOf(manifestSha, manifestBytes),
  );
  const all = [...blobItems, ...manifestItems];
  deps.onProgress?.("正在核对远端…");
  const missing = await deps.transport.missing(
    all.map((item) => item.id),
    deps.signal,
  );
  const total = pendingOf(all, missing).length;
  let done = 0;
  const uploaded = () => deps.onProgress?.(`正在上传 ${++done}/${total}`);
  if (total) deps.onProgress?.(`正在上传 0/${total}`);
  for (const blob of meta.blobs) {
    const plans = blobItems.filter((item) => item.sha256 === blob.sha256);
    if (!plans.some((plan) => missing.has(plan.id))) continue;
    throwIfAborted(deps.signal);
    const stored = blobFile(blob.sha256);
    if (!stored.exists || stored.size !== blob.bytes)
      throw new Error(
        `备份里的照片已不在本机：${owners.get(blob.sha256)?.name ?? blob.sha256.slice(0, 8)}`,
      );
    await uploadContent(stored, plans, missing, deps, uploaded);
  }
  if (manifestItems.some((plan) => missing.has(plan.id)))
    await uploadContent(manifest, manifestItems, missing, deps, uploaded);
  const index: RemoteIndex = {
    v: 1,
    sha256: manifestSha,
    bytes: manifestBytes,
    parts: manifestItems.length,
    createdAt: meta.createdAt,
    blobs: meta.blobs.length,
    blobBytes: blobBytesOf(meta),
  };
  deps.onProgress?.("正在写远端清单…");
  // 清单引用的对象随索引一起登记，服务端 prune 时自己护住它们；
  // 服务端一次最多认 50000 个 id，超过就这轮既不登记也不收拾，宁可多占。
  const ids = all.map((item) => item.id);
  const registered = ids.length <= 50000 ? ids : [];
  await deps.transport.putManifest(
    keyId,
    toBase64(sealSmall(deps.key, INDEX_LABEL, utf8(JSON.stringify(index)))),
    registered,
    deps.signal,
  );
  if (registered.length) await deps.transport.prune(registered, deps.signal);
  const remote: RemoteState = {
    version: 1,
    enabled: true,
    keyId,
    lastBackupAt: new Date().toISOString(),
    lastBackupBytes: index.blobBytes + manifestBytes,
    lastBackupObjects: all.length,
  };
  writeRemoteState(remote);
  return remote;
}
function parseIndex(plain: Uint8Array): RemoteIndex {
  let index: RemoteIndex;
  try {
    index = JSON.parse(new TextDecoder().decode(plain)) as RemoteIndex;
  } catch {
    throw new SyncError("CORRUPT", "远端索引对不上，可能被改动过。");
  }
  if (
    index?.v !== 1 ||
    !/^[a-f0-9]{64}$/.test(index.sha256) ||
    !Number.isSafeInteger(index.bytes) ||
    index.bytes < 12 ||
    !Number.isSafeInteger(index.parts) ||
    index.parts < 1 ||
    index.parts !== objectsOf(index.sha256, index.bytes).length
  )
    throw new SyncError("CORRUPT", "远端索引对不上，可能被改动过。");
  return index;
}
/** 解出 .xmbm 全文：魔数 + meta + 实体，长度必须正好。 */
function parseManifestBytes(bytes: Uint8Array): {
  meta: BackupMetaV2;
  entities: Uint8Array;
} {
  const broken = () =>
    new SyncError("CORRUPT", "远端清单对不上，可能被改动过。");
  if (bytes.length < 12 || !BACKUP_MAGIC_V3.every((b, i) => bytes[i] === b))
    throw broken();
  const metaBytes = new DataView(bytes.buffer, bytes.byteOffset, 12).getUint32(
    8,
  );
  if (metaBytes > META_LIMIT || 12 + metaBytes > bytes.length) throw broken();
  const meta = decodeMetaV2(bytes.subarray(12, 12 + metaBytes));
  if (12 + metaBytes + meta.entityBytes !== bytes.length) throw broken();
  return { meta, entities: bytes.subarray(12 + metaBytes) };
}
/** 逐对象下载并解密一份内容，块按顺序交给 sink。 */
async function downloadContent(
  sha256Hex_: string,
  bytes: number,
  deps: EngineDeps,
  sink: (chunk: Uint8Array) => void,
): Promise<void> {
  for (const plan of objectsOf(sha256Hex_, bytes)) {
    throwIfAborted(deps.signal);
    const sealed = await deps.transport.get(
      objectIdOf(deps.key, plan.sha256, plan.part),
      deps.signal,
    );
    const chunks = openObject(deps.key, plan, sealed);
    const sizes = chunkSizes(plan.bytes);
    if (
      chunks.length !== sizes.length ||
      chunks.some((chunk, i) => chunk.length !== sizes[i])
    )
      throw new SyncError("CORRUPT", "远端这一份对不上，可能被改动过。");
    for (const chunk of chunks) {
      sink(chunk);
      await tick();
    }
  }
}
/** 取回索引与清单：钥匙不对在下载任何对象之前就判出。 */
async function fetchManifest(deps: EngineDeps): Promise<{
  index: RemoteIndex;
  meta: BackupMetaV2;
  entities: Uint8Array;
  bytes: Uint8Array;
}> {
  const remote = await deps.transport.getManifest(deps.signal);
  if (!remote) throw new SyncError("NOT_FOUND", "远端还没有备份。");
  if (remote.keyId !== keyIdOf(deps.key))
    throw new SyncError("WRONG_CODE", WRONG_CODE);
  const index = parseIndex(
    openSmall(deps.key, INDEX_LABEL, fromBase64(remote.index)),
  );
  deps.onProgress?.("正在读取远端清单…");
  const pieces: Uint8Array[] = [];
  await downloadContent(index.sha256, index.bytes, deps, (chunk) =>
    pieces.push(chunk),
  );
  const bytes = new Uint8Array(index.bytes);
  let at = 0;
  for (const piece of pieces) {
    bytes.set(piece, at);
    at += piece.length;
  }
  if (at !== index.bytes || sha256Hex(bytes) !== index.sha256)
    throw new SyncError("CORRUPT", "远端清单对不上，可能被改动过。");
  const { meta, entities } = parseManifestBytes(bytes);
  return { index, meta, entities, bytes };
}
/** 核对远端：索引、清单与每一个素材对象都在。不下载素材本身。 */
export async function verifyRemoteBackup(
  deps: EngineDeps,
): Promise<RemoteSummary> {
  const { index, meta } = await fetchManifest(deps);
  const ids = planUpload(meta.blobs, idOf(deps.key)).map((item) => item.id);
  deps.onProgress?.("正在核对远端…");
  const missing = await deps.transport.missing(ids, deps.signal);
  if (missing.size)
    throw new SyncError(
      "INCOMPLETE",
      `远端少了 ${missing.size} 份照片的数据，请再备份一次。`,
    );
  return {
    createdAt: meta.createdAt,
    objects: ids.length + index.parts,
    bytes: blobBytesOf(meta) + index.bytes,
  };
}
/**
 * 从远端恢复到本机 blob 库并写一份 .xmbm，返回它——之后交给 restoreBackup／recoverStartupBackup，
 * 与本机备份走同一条恢复路径。已经在库里且长度对的 blob 跳过，所以中断后再来就是续传。
 */
export async function restoreFromRemote(deps: EngineDeps): Promise<File> {
  const { meta, entities, bytes } = await fetchManifest(deps);
  const owners = blobOwners(decodeLibraryV2(meta, entities));
  ensureDirectories();
  const total = meta.blobs.length;
  let done = 0;
  for (const blob of meta.blobs) {
    throwIfAborted(deps.signal);
    const target = blobFile(blob.sha256);
    if (target.exists && target.size === blob.bytes) {
      deps.onProgress?.(`正在下载 ${++done}/${total}`);
      continue;
    }
    blobPrefixDirectory(blob.sha256).create({
      intermediates: true,
      idempotent: true,
    });
    const part = blobPartFile(blob.sha256);
    if (part.exists) part.delete();
    part.create();
    const h = part.open(FileMode.WriteOnly);
    const digest = sha256.create();
    let written = 0;
    try {
      await downloadContent(blob.sha256, blob.bytes, deps, (chunk) => {
        h.writeBytes(chunk);
        digest.update(chunk);
        written += chunk.length;
      });
    } catch (e) {
      h.close();
      if (part.exists) part.delete();
      throw e;
    }
    h.close();
    if (written !== blob.bytes || bytesToHex(digest.digest()) !== blob.sha256) {
      part.delete();
      throw new SyncError(
        "CORRUPT",
        `远端这张照片对不上：${owners.get(blob.sha256)?.name ?? blob.sha256.slice(0, 8)}`,
      );
    }
    if (target.exists) target.delete();
    await part.move(target);
    deps.onProgress?.(`正在下载 ${++done}/${total}`);
  }
  const out = new File(
    backupDirectory,
    backupFileName(new Date(), randomUUID().slice(0, 8), "xmbm"),
  );
  out.create();
  const h = out.open(FileMode.WriteOnly);
  try {
    h.writeBytes(bytes);
  } catch (e) {
    // 写不进去就别留一个空清单：任何一份清单读不出来，blob 回收都会停手。
    h.close();
    out.delete();
    throw e;
  }
  h.close();
  return out;
}
