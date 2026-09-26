import { File, FileMode } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import {
  BackupStopped,
  createBackup,
  restorePinName,
  restorePins,
  withoutPendingRecordings,
} from "../local/backup";
import { decodeLibraryV2, encodeEntities } from "../local/backup-format";
import {
  backupDirectory,
  blobFile,
  ensureDirectories,
  mediaDirectory,
  mediaFile,
  mediaUri,
  pumpBytes,
  renderThumb,
} from "../local/files";
import {
  ENTITY_KINDS,
  freezeLibrary,
  type Library,
  type LocalMedia,
} from "../local/model";
import type { LocalStore } from "../local/store";
import { fromBase64, keyIdOf, openSmall } from "./crypto";
import {
  assertSameKey,
  downloadBlob,
  fetchManifestOf,
  INDEX_LABEL,
  parseIndex,
  publishedRootOf,
  publishedSha,
  pushManifest,
  sharedLibrary,
  throwIfAborted,
  type EngineDeps,
} from "./engine";
import {
  canonical,
  mergeLibraries,
  type Conflict,
  type RemoteSnapshot,
} from "./merge";
import {
  clearSyncFiles,
  forgetKey,
  freshRemoteState,
  readBase,
  readConflicts,
  readRemoteState,
  storeKey,
  writeBase,
  writeConflicts,
  writeRemoteState,
  type RemoteState,
} from "./state";
import { SyncError } from "./transport";

/** 钉子先落地，下载途中做本机备份、回收也不会收走刚拿回的照片。 */
function pinManifest(bytes: Uint8Array, sha: string): File {
  const pin = new File(
    backupDirectory,
    restorePinName(new Date(), `${randomUUID()}-${sha}`),
  );
  pin.create();
  try {
    pin.write(bytes);
  } catch (e) {
    pin.delete();
    throw e;
  }
  return pin;
}

/** 文件名属于这台手机；先占住空名字，再开始耗时的复制与缩略图。 */
async function materialize(
  remote: LocalMedia,
  reserved: Set<string>,
  created: File[],
  deps: EngineDeps,
): Promise<LocalMedia> {
  const m = { ...remote };
  while (reserved.has(m.file) || mediaFile(m).exists)
    m.file = `${randomUUID()}-${remote.file}`;
  const target = mediaFile(m);
  target.create();
  created.push(target);
  reserved.add(m.file);
  const source = blobFile(m.sha256);
  const input = source.open(FileMode.ReadOnly);
  try {
    const output = target.open(FileMode.WriteOnly);
    try {
      const hash = await pumpBytes(input, m.bytes, output, () =>
        throwIfAborted(deps.signal),
      );
      if (source.size !== m.bytes || hash !== m.sha256)
        throw new SyncError("CORRUPT", `这张照片对不上：${m.name}`);
    } finally {
      output.close();
    }
  } finally {
    input.close();
  }
  throwIfAborted(deps.signal);
  let id: string, thumb: File;
  do {
    id = randomUUID();
    thumb = new File(mediaDirectory, `${id}_t.jpg`);
  } while (reserved.has(thumb.name) || thumb.exists);
  // renderThumb 会覆盖目标；占位文件只属于本轮，失败时连半张缩略图一起清掉。
  thumb.create();
  created.push(thumb);
  reserved.add(thumb.name);
  const rendered = await renderThumb(m.kind, mediaUri(m), id);
  if (!rendered && thumb.exists) thumb.delete();
  return { ...m, ...rendered };
}

/**
 * 某一台的资料本身读不了（对象缺了、对不上、解不开）：跳过那一台，别让它拦下本机与其他人的同步。
 * 网络、授权、服务端出错、写盘失败与停止不算，照常整轮失败、下次重来。
 */
function unreadable(e: unknown): boolean {
  return (
    e instanceof SyncError && (e.code === "NOT_FOUND" || e.code === "CORRUPT")
  );
}
/** 解索引、解清单只在内存里算：这里的普通错误就是内容坏了。 */
function undecodable(e: unknown): boolean {
  return (
    unreadable(e) ||
    (e instanceof Error &&
      !(e instanceof SyncError) &&
      !(e instanceof BackupStopped))
  );
}
function combineConflicts(earlier: readonly Conflict[], added: readonly Conflict[]): Conflict[] {
  const conflicts = new Map<string, Conflict>();
  for (const conflict of [...earlier, ...added]) {
    const old = conflicts.get(conflict.key);
    if (!old || Date.parse(old.at) <= Date.parse(conflict.at))
      conflicts.set(conflict.key, conflict);
  }
  return [...conflicts.values()];
}
/**
 * 上一次核对过（或刚发布）的共享内容：实体按对象、发出去的库根（publishedRootOf，与清单同源）按规范 JSON 记下。库里实体深冻结、只整个替换，
 * 对象都没换就不用再把整份库编码、哈希一遍（一万段在没有 JIT 的手机上要好几秒）。
 */
let published: { sha: string; refs: Map<string, object>; root: string } | undefined;
function sharedRefs(lib: Library): Map<string, object> {
  const shared = sharedLibrary(lib);
  const refs = new Map<string, object>();
  for (const kind of ENTITY_KINDS)
    for (const [id, entity] of Object.entries(shared[kind]))
      refs.set(`${kind}:${id}`, entity);
  return refs;
}
function rememberPublished(lib: Library, sha: string): void {
  published = { sha, refs: sharedRefs(lib), root: canonical(publishedRootOf(lib)) };
}
function publishedUnchanged(lib: Library, sha: string): boolean {
  const refs = sharedRefs(lib),
    root = canonical(publishedRootOf(lib));
  if (
    published?.sha === sha &&
    published.root === root &&
    published.refs.size === refs.size &&
    [...refs].every(([id, entity]) => published!.refs.get(id) === entity)
  )
    return true;
  const current = publishedSha(
    encodeEntities(withoutPendingRecordings(sharedLibrary(lib))),
    lib,
  );
  if (current !== sha) return false;
  published = { sha, refs, root };
  return true;
}
/** 准备文件不占写队列；最终合并一定用写队列里的新鲜资料。 */
export async function runFamilySync(
  store: LocalStore,
  deps: EngineDeps,
): Promise<RemoteState> {
  try {
    return await syncFamily(store, deps);
  } catch (e) {
    if (e instanceof BackupStopped) throw new SyncError("CANCELED", "已停止。");
    throw e;
  }
}
async function syncFamily(
  store: LocalStore,
  deps: EngineDeps,
): Promise<RemoteState> {
  throwIfAborted(deps.signal);
  const keyId = await assertSameKey(deps);
  const previous = await readRemoteState();
  const state = previous?.keyId === keyId ? previous : freshRemoteState(keyId);
  const base = await readBase();
  const seen = { ...state.seen };
  deps.onProgress?.("正在读取远端清单…");
  const entries = await deps.transport.manifests(deps.signal);
  let snapshots: RemoteSnapshot[] = [];
  const manifests = new Map<
    string,
    Awaited<ReturnType<typeof fetchManifestOf>>
  >();
  const pins: File[] = [];
  // 读不了的那几台这一轮先不并、也不记作已读，下一轮再试；记下原因，读不了的是本机自己时照原样报错。
  const unread = new Map<string, unknown>();
  ensureDirectories();
  for (const entry of entries) {
    throwIfAborted(deps.signal);
    // 异钥匙残留不能用当前钥匙解索引；最新清单的钥匙已在入口核过。
    if (entry.keyId !== keyId) continue;
    let read: {
      manifest: Awaited<ReturnType<typeof fetchManifestOf>>;
      library: RemoteSnapshot["library"];
    };
    try {
      const index = parseIndex(
        openSmall(deps.key, INDEX_LABEL, fromBase64(entry.index)),
      );
      if (seen[entry.deviceId] === index.sha256) continue;
      const manifest = await fetchManifestOf(entry, deps);
      const library = decodeLibraryV2(manifest.meta, manifest.entities);
      // 冻住：这一轮要合并两次（先算要下载什么，再在写队列里合），实体的哈希按对象记住，第二次不用重算。
      freezeLibrary(library);
      read = { manifest, library };
    } catch (e) {
      if (!undecodable(e)) throw e;
      unread.set(entry.deviceId, e);
      continue;
    }
    manifests.set(entry.deviceId, read.manifest);
    snapshots.push({
      deviceId: entry.deviceId,
      deviceName: entry.deviceName,
      createdAt: read.manifest.meta.createdAt,
      library: read.library,
    });
    pins.push(pinManifest(read.manifest.bytes, read.manifest.index.sha256));
  }
  const now = new Date().toISOString();
  let merged = mergeLibraries(store.get(), snapshots, base, now);
  // 一张照片在远端缺了或对不上：带着它的那几台这一轮不并，合并重来；每次至少少一台，必然收敛。
  for (;;) {
    const blobs = new Map(
      snapshots.flatMap(({ deviceId }) =>
        manifests
          .get(deviceId)!
          .meta.blobs.map((b) => [b.sha256, b] as const),
      ),
    );
    let done = 0;
    let broken: LocalMedia | undefined;
    let cause: unknown;
    for (const m of merged.wantedMedia) {
      throwIfAborted(deps.signal);
      const blob = blobs.get(m.sha256);
      try {
        if (!blob || blob.bytes !== m.bytes)
          throw new SyncError("CORRUPT", `远端这张照片对不上：${m.name}`);
        await downloadBlob(blob, deps, m.name);
      } catch (e) {
        if (!unreadable(e)) throw e;
        broken = m;
        cause = e;
        break;
      }
      deps.onProgress?.(`正在下载 ${++done}/${merged.wantedMedia.length}`);
    }
    if (!broken) break;
    const { id, sha256 } = broken;
    const carriers = snapshots.filter(
      (r) => r.library.media[id]?.sha256 === sha256,
    );
    for (const r of carriers) unread.set(r.deviceId, cause);
    snapshots = snapshots.filter((r) => !carriers.includes(r));
    merged = mergeLibraries(store.get(), snapshots, base, now);
  }
  // 上传会整份换掉本机自己的清单、删掉本成员旧版迁来的那份：它们读不了（比如清过同步状态后）就不能跳过，
  // 否则没并进来的历史连同它引用的对象会被回收。认不出本机时也照原样报错。
  if (unread.size) {
    const { deviceId: self } = await deps.transport.me(deps.signal);
    for (const [deviceId, cause] of unread)
      if (!self || deviceId === self || deviceId.startsWith("legacy:"))
        throw cause;
  }
  for (const r of snapshots)
    seen[r.deviceId] = manifests.get(r.deviceId)!.index.sha256;
  const created: File[] = [];
  const prepared = new Map<string, LocalMedia>();
  const reserved = new Set(
    Object.values(store.get().media).flatMap((m) => [
      m.file,
      ...(m.thumb ? [m.thumb] : []),
    ]),
  );
  try {
    for (const m of merged.wantedMedia) {
      throwIfAborted(deps.signal);
      prepared.set(m.id, await materialize(m, reserved, created, deps));
    }
    deps.onProgress?.("正在写入本机资料…");
    const earlier = await readConflicts();
    await store.change((current) => {
      throwIfAborted(deps.signal);
      merged = mergeLibraries(current, snapshots, base, now);
      for (const m of merged.wantedMedia) {
        const ready = prepared.get(m.id);
        if (!ready || ready.sha256 !== m.sha256 || ready.bytes !== m.bytes)
          throw new SyncError("INCOMPLETE", "资料刚有变化，请再同步一次。");
        merged.next.media[m.id] = ready;
      }
      // 输的一版先落盘再换库：写不进去就不换，本机那一版原样留着；换库失败只多一张重复的卡。
      if (merged.conflicts.length) writeConflicts(combineConflicts(earlier, merged.conflicts));
      Object.assign(current, merged.next);
    });
  } catch (e) {
    for (const file of created) if (file.exists) file.delete();
    throw e;
  }
  // 新鲜合并可能不再需要某张照片；只清本轮多准备的文件。
  const used = new Set(
    Object.values(merged.next.media).flatMap((m) => [
      m.file,
      ...(m.thumb ? [m.thumb] : []),
    ]),
  );
  for (const file of created)
    if (!used.has(file.name) && file.exists) file.delete();
  // 库已写好，先留住输的一版；上传失败后重试也不能把这段字忘掉。
  writeConflicts(combineConflicts(await readConflicts(), merged.conflicts));
  // 合并已落进本机库：基和已读清单也要跟上。否则上传失败后下一轮拿旧基再合一遍，
  // 本机改过的拉取内容会被当成两边都改而出假冲突卡，那几份清单也要重下。
  writeBase(merged.base);
  writeRemoteState({
    ...state,
    autoSync: (await readRemoteState())?.autoSync ?? state.autoSync,
    seen: { ...seen },
  });
  // 停用后重新获准的手机换了设备号，旧设备那份清单还留在远端：拿它比「没变」会一直不发布这台。
  const { deviceId: current } = await deps.transport.me(deps.signal);
  const own = state.deviceId
    ? entries.find(
        (entry) => entry.deviceId === state.deviceId && entry.keyId === keyId,
      )
    : undefined;
  // 本机旧清单读不了也不要紧：当作变了，照常发布一份新的。
  let ownIndex: ReturnType<typeof parseIndex> | undefined;
  try {
    ownIndex = own
      ? parseIndex(openSmall(deps.key, INDEX_LABEL, fromBase64(own.index)))
      : undefined;
  } catch (e) {
    if (!undecodable(e)) throw e;
  }
  // 上传的就是这一刻的库（下面两次 store.get() 与这里在同一段同步代码里）。
  deps.onSnapshot?.();
  // meta.createdAt 让清单字节每次不同，所以要比实体段而不是整份清单。
  const snapshot = store.get();
  const unchanged =
    state.lastPush &&
    (!current || current === state.deviceId) &&
    ownIndex?.sha256 === state.lastPush.manifestSha &&
    publishedUnchanged(snapshot, state.lastPush.entitiesSha);
  const pushed = unchanged ? null : await pushManifest(snapshot, deps);
  if (pushed) rememberPublished(snapshot, pushed.entitiesSha);
  throwIfAborted(deps.signal);
  const deviceId = current;
  if (deviceId && pushed) seen[deviceId] = pushed.index.sha256;
  const result: RemoteState = {
    ...state,
    // 同步期间外观页可能关掉自动同步，不能用开始时的快照覆盖她的选择。
    autoSync: (await readRemoteState())?.autoSync ?? state.autoSync,
    enabled: true,
    seen,
    ...(pushed
      ? {
          lastPush: {
            entitiesSha: pushed.entitiesSha,
            manifestSha: pushed.manifestSha,
          },
        }
      : {}),
    ...(deviceId ? { deviceId } : {}),
    lastSyncAt: new Date().toISOString(),
    lastSyncSummary: {
      devices: new Set([
        ...entries.map((e) => e.deviceId),
        ...(deviceId ? [deviceId] : []),
      ]).size,
      objects: pushed?.objects ?? state.lastSyncSummary?.objects ?? 0,
      bytes: pushed?.bytes ?? state.lastSyncSummary?.bytes ?? 0,
      pulled: merged.pulled,
      pushed: pushed?.pushed ?? 0,
      conflicts: merged.conflicts.length,
      ...(unread.size ? { unread: unread.size } : {}),
    },
  };
  delete result.lastError;
  writeBase(merged.base);
  writeRemoteState(result);
  // 只收本次处理的清单钉子（含上次中断的同一份）；其他中断钉子按既有七天期限收拾。
  const completed = new Set([...manifests.values()].map((m) => m.index.sha256));
  for (const pin of restorePins())
    if (
      pins.some((p) => p.uri === pin.uri) ||
      [...completed].some((sha) => pin.name.endsWith(`-${sha}.xmbm.part`))
    )
      pin.delete();
  return result;
}

export async function joinFamily(
  store: LocalStore,
  key: Uint8Array,
  deps: Omit<EngineDeps, "key">,
): Promise<RemoteState> {
  throwIfAborted(deps.signal);
  const keyId = keyIdOf(key);
  const status = await deps.transport.status(deps.signal);
  if (status.keyId && status.keyId !== keyId)
    throw new SyncError(
      "WRONG_CODE",
      "这份恢复码打不开远端的备份，请核对后再试。",
    );
  throwIfAborted(deps.signal);
  const previous = await readRemoteState();
  await storeKey(key);
  if (previous?.keyId !== keyId) clearSyncFiles();
  writeRemoteState(freshRemoteState(keyId));
  return runFamilySync(store, { ...deps, key });
}

/**
 * 刚获准（或找回）的手机第一次并入家人的时光：先在本机留一份保留备份，再按三方合并并入，不整库替换。
 * 备份失败就不并；已有记录的手机在界面上先确认过「会和家人共享」。
 */
export async function startSharing(
  store: LocalStore,
  key: Uint8Array,
  deps: Omit<EngineDeps, "key">,
): Promise<RemoteState> {
  throwIfAborted(deps.signal);
  deps.onProgress?.("正在给这台手机留一份本机备份…");
  try {
    await createBackup(store.get(), deps.onProgress, deps.signal);
  } catch (e) {
    if (e instanceof BackupStopped) throw new SyncError("CANCELED", "已停止。");
    throw e;
  }
  return joinFamily(store, key, deps);
}
/**
 * 凭恢复码找回后先真读一份：解开最新一份清单（索引与清单都要解得开、读得出库）才算找回。
 * 服务上还没有任何清单时没什么可读，返回 null；有清单却没有一份是这把钥匙的，说明钥匙不对。
 */
export async function readNewestManifest(
  deps: EngineDeps,
): Promise<{ deviceName: string | null; createdAt: string } | null> {
  const entries = await deps.transport.manifests(deps.signal);
  if (!entries.length) return null;
  const keyId = keyIdOf(deps.key);
  const newest = entries
    .filter((entry) => entry.keyId === keyId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!newest)
    throw new SyncError("WRONG_CODE", "找回的钥匙打不开远端的内容。");
  const manifest = await fetchManifestOf(newest, deps);
  decodeLibraryV2(manifest.meta, manifest.entities);
  return { deviceName: newest.deviceName, createdAt: manifest.meta.createdAt };
}

/**
 * 退出不需要打开本机库。先撤下清单、再作废设备，最后忘掉本机钥匙。顺序不能反：作废之后这台的令牌就不认了，
 * 撤不了自己的清单；服务端也不替作废的设备删清单（同一成员的其他手机照样读得到它）。
 * 家庭服务拒绝退出（例如已成为最后一台管理者手机）或暂时不可达时，保留钥匙与同步状态；清单已撤下的话，
 * republish 尽力马上发回一份（没发成也不要紧：远端没有本机清单，下一轮同步照常整份发布，被收走的对象随之补传）。
 */
export async function leaveFamily(
  deps: Pick<EngineDeps, "transport" | "signal"> & {
    revokeDevice?: () => Promise<unknown>;
    republish?: () => Promise<unknown>;
  },
): Promise<{ removedRemote: boolean }> {
  let removedRemote = false;
  try {
    throwIfAborted(deps.signal);
    const state = await readRemoteState();
    const deviceId =
      state?.deviceId ??
      (await deps.transport.me(deps.signal)).deviceId;
    if (deviceId) {
      await deps.transport.deleteManifest(deviceId, deps.signal);
      removedRemote = true;
    }
  } catch (e) {
    if (
      !(e instanceof SyncError) ||
      (e.status !== null && e.status >= 500) ||
      !["NETWORK", "TIMEOUT", "AUTH_REQUIRED", "NOT_FOUND"].includes(e.code)
    )
      throw e;
  }
  try {
    await deps.revokeDevice?.();
  } catch (e) {
    if (removedRemote) await deps.republish?.().catch(() => undefined);
    throw e;
  }
  await forgetKey();
  clearSyncFiles();
  return { removedRemote };
}
