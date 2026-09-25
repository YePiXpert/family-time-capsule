import { File, FileMode } from "expo-file-system";
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
  blobOwners,
  createSyncManifest,
  readManifest,
  type RestoreProgress,
} from "../local/backup";
import {
  CHUNK,
  blobFile,
  blobPartFile,
  blobPrefixDirectory,
  hashFile,
  type FileHandle,
} from "../local/files";
import { referencedMedia, type Library } from "../local/model";
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
import { SyncError, type RemoteManifest, type Transport } from "./transport";
import { canonical, sharedRootOf } from "./merge";
/**
 * 远端备份引擎：本机清单备份（.xmbm + blob 库）是源头，远端只是它的密文副本。
 * 备份 = 写本机清单 → 规划对象 → 问远端缺哪些 → 只传缺的 → 传清单对象与索引 → 收拾多余对象。
 * 同步复用这里的清单与对象传输，合并和物化由 family.ts 负责。
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
  /** 家人同步取定要上传的那一版库时同步调用：此后的改动不在这一轮里，自动同步据此补排一轮。 */
  onSnapshot?: () => void;
};
export type RemoteSummary = {
  createdAt: string;
  objects: number;
  bytes: number;
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const utf8 = (text: string) => new TextEncoder().encode(text);
const stopped = () => new SyncError("CANCELED", "已停止。");
export const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw stopped();
};
const KEY_MISMATCH =
  "这台手机的钥匙和家里远端的对不上。请到「设置 → 家庭与同步」退出后重新加入。";
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
      throwIfAborted(deps.signal);
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
export async function assertSameKey(deps: EngineDeps): Promise<string> {
  const keyId = keyIdOf(deps.key);
  const status = await deps.transport.status(deps.signal);
  if (status.keyId && status.keyId !== keyId)
    throw new SyncError("KEY_MISMATCH", KEY_MISMATCH);
  return keyId;
}
/**
 * 发到家里的那份库：草稿只在这台手机上（加入页与同步卡都这样说），素材只发共享内容用到的——
 * 草稿里的、从草稿移出或随草稿放弃的照片录音都不传。家人合并只要共享实体引用到的素材，
 * 本来就不看别人清单里的草稿；校验要求的记录、信、头像素材都在这里面。
 */
export function sharedLibrary(state: Library): Library {
  const rest: Library = { ...state, drafts: {} };
  const used = new Set([
    ...referencedMedia(rest),
    ...Object.values(rest.records).flatMap((r) => r.coverId ?? []),
    ...Object.values(rest.letters).flatMap((l) => l.coverId ?? []),
    ...Object.values(rest.albums).flatMap((a) => a.coverId ?? []),
    ...Object.values(rest.selections).flatMap((q) => q.coverId ?? []),
    ...Object.values(rest.series).flatMap((x) => x.items.map((i) => i.mediaId)),
    ...Object.values(rest.yearCovers),
  ]);
  rest.media = Object.fromEntries(
    Object.entries(state.media).filter(([id]) => used.has(id)),
  );
  return rest;
}
/**
 * 「发出去的内容」的指纹：共享实体段加上共享的库根。只比实体段的话，只改年度寄语或宝宝资料的手机
 * 会以为没变、一直不发布（存的字段仍叫 entitiesSha，旧版存的值对不上，升级后多发布一次）。
 */
export function publishedSha(entities: Uint8Array, state: Library): string {
  const root = utf8(`\n${canonical(sharedRootOf(state))}`);
  const bytes = new Uint8Array(entities.length + root.length);
  bytes.set(entities);
  bytes.set(root, entities.length);
  return sha256Hex(bytes);
}
/** 本机清单是上传的唯一来源；已在远端的对象不重复传。 */
export async function pushManifest(state: Library, deps: EngineDeps) {
  const keyId = keyIdOf(deps.key);
  deps.onProgress?.("正在整理照片…");
  const manifest = await createSyncManifest(
    sharedLibrary(state),
    deps.onProgress,
    deps.signal,
  );
  const { meta, entities } = readManifest(manifest);
  const entitiesSha = publishedSha(entities, state);
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
  // 计数不能放在可选回调的参数里：没传进度回调时 `?.()` 会连参数一起跳过。
  const uploaded = () => {
    done++;
    deps.onProgress?.(`正在上传 ${done}/${total}`);
  };
  if (total) deps.onProgress?.(`正在上传 0/${total}`);
  const plansOf = new Map<string, UploadItem[]>();
  for (const item of blobItems) {
    const list = plansOf.get(item.sha256);
    if (list) list.push(item);
    else plansOf.set(item.sha256, [item]);
  }
  for (const blob of meta.blobs) {
    const plans = plansOf.get(blob.sha256) ?? [];
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
  const registered = ids.length <= 50000 ? ids : undefined;
  throwIfAborted(deps.signal);
  await deps.transport.putManifest(
    keyId,
    toBase64(sealSmall(deps.key, INDEX_LABEL, utf8(JSON.stringify(index)))),
    registered,
    deps.signal,
  );
  if (registered?.length) await deps.transport.prune(registered, deps.signal);
  return {
    index,
    manifestSha,
    entitiesSha,
    objects: all.length,
    bytes: index.blobBytes + manifestBytes,
    pushed: done,
  };
}
export function parseIndex(plain: Uint8Array): RemoteIndex {
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
export async function downloadContent(
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
    let chunks: Uint8Array[];
    try {
      chunks = openObject(deps.key, plan, sealed);
    } catch (e) {
      throw new SyncError(
        "CORRUPT",
        e instanceof Error ? e.message : "远端这一份对不上，可能被改动过。",
      );
    }
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
/** 本设备清单仍用于「验证」；家庭同步按设备条目读取。 */
async function fetchManifest(deps: EngineDeps) {
  const remote = await deps.transport.getManifest(deps.signal);
  if (!remote) throw new SyncError("NOT_FOUND", "远端还没有备份。");
  return fetchManifestOf(remote, deps);
}
/** 取回索引与清单：钥匙不对在下载任何对象之前就判出。 */
export async function fetchManifestOf(
  remote: Pick<RemoteManifest, "keyId" | "index">,
  deps: EngineDeps,
): Promise<{
  index: RemoteIndex;
  meta: BackupMetaV2;
  entities: Uint8Array;
  bytes: Uint8Array;
}> {
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
/** 已完成的 blob 留作续传；半成品只有长度与哈希都对上才换名。 */
export async function downloadBlob(
  blob: BackupMetaV2["blobs"][number],
  deps: EngineDeps,
  name = blob.sha256.slice(0, 8),
): Promise<void> {
  throwIfAborted(deps.signal);
  const target = blobFile(blob.sha256);
  if (target.exists && target.size === blob.bytes) return;
  blobPrefixDirectory(blob.sha256).create({
    intermediates: true,
    idempotent: true,
  });
  const part = blobPartFile(blob.sha256);
  if (part.exists) part.delete();
  part.create();
  try {
    const h = part.open(FileMode.WriteOnly);
    const digest = sha256.create();
    let written = 0;
    try {
      await downloadContent(blob.sha256, blob.bytes, deps, (chunk) => {
        h.writeBytes(chunk);
        digest.update(chunk);
        written += chunk.length;
      });
    } finally {
      h.close();
    }
    if (written !== blob.bytes || bytesToHex(digest.digest()) !== blob.sha256)
      throw new SyncError("CORRUPT", `远端这张照片对不上：${name}`);
    throwIfAborted(deps.signal);
    if (target.exists) target.delete();
    await part.move(target);
  } catch (e) {
    if (part.exists) part.delete();
    throw e;
  }
}
