import { File, FileMode } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { BackupStopped, restorePinName, restorePins } from "../local/backup";
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
import type { LocalMedia } from "../local/model";
import type { LocalStore } from "../local/store";
import { fromBase64, keyIdOf, openSmall, sha256Hex } from "./crypto";
import {
  assertSameKey,
  downloadBlob,
  fetchManifestOf,
  INDEX_LABEL,
  parseIndex,
  pushManifest,
  throwIfAborted,
  type EngineDeps,
} from "./engine";
import { mergeLibraries, type Conflict, type RemoteSnapshot } from "./merge";
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
  const snapshots: RemoteSnapshot[] = [];
  const manifests: Awaited<ReturnType<typeof fetchManifestOf>>[] = [];
  const pins: File[] = [];
  ensureDirectories();
  for (const entry of entries) {
    throwIfAborted(deps.signal);
    // 异钥匙残留不能用当前钥匙解索引；最新清单的钥匙已在入口核过。
    if (entry.keyId !== keyId) continue;
    const index = parseIndex(
      openSmall(deps.key, INDEX_LABEL, fromBase64(entry.index)),
    );
    if (seen[entry.deviceId] === index.sha256) continue;
    const manifest = await fetchManifestOf(entry, deps);
    const library = decodeLibraryV2(manifest.meta, manifest.entities);
    manifests.push(manifest);
    snapshots.push({
      deviceId: entry.deviceId,
      deviceName: entry.deviceName,
      createdAt: manifest.meta.createdAt,
      library,
    });
    pins.push(pinManifest(manifest.bytes, index.sha256));
    seen[entry.deviceId] = index.sha256;
  }
  const now = new Date().toISOString();
  let merged = mergeLibraries(store.get(), snapshots, base, now);
  const blobs = new Map(
    manifests.flatMap(({ meta }) =>
      meta.blobs.map((b) => [b.sha256, b] as const),
    ),
  );
  let done = 0;
  for (const m of merged.wantedMedia) {
    throwIfAborted(deps.signal);
    const blob = blobs.get(m.sha256);
    if (!blob || blob.bytes !== m.bytes)
      throw new SyncError("CORRUPT", `远端这张照片对不上：${m.name}`);
    await downloadBlob(blob, deps, m.name);
    deps.onProgress?.(`正在下载 ${++done}/${merged.wantedMedia.length}`);
  }
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
    await store.change((current) => {
      throwIfAborted(deps.signal);
      merged = mergeLibraries(current, snapshots, base, now);
      for (const m of merged.wantedMedia) {
        const ready = prepared.get(m.id);
        if (!ready || ready.sha256 !== m.sha256 || ready.bytes !== m.bytes)
          throw new SyncError("INCOMPLETE", "资料刚有变化，请再同步一次。");
        merged.next.media[m.id] = ready;
      }
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
  const conflicts = new Map<string, Conflict>();
  for (const conflict of [...(await readConflicts()), ...merged.conflicts]) {
    const old = conflicts.get(conflict.key);
    if (!old || Date.parse(old.at) <= Date.parse(conflict.at))
      conflicts.set(conflict.key, conflict);
  }
  writeConflicts([...conflicts.values()]);
  const own = state.deviceId
    ? entries.find(
        (entry) => entry.deviceId === state.deviceId && entry.keyId === keyId,
      )
    : undefined;
  const ownIndex = own
    ? parseIndex(openSmall(deps.key, INDEX_LABEL, fromBase64(own.index)))
    : undefined;
  // 上传的就是这一刻的库（下面两次 store.get() 与这里在同一段同步代码里）。
  deps.onSnapshot?.();
  // meta.createdAt 让清单字节每次不同，所以要比实体段而不是整份清单。
  const unchanged =
    state.lastPush &&
    ownIndex?.sha256 === state.lastPush.manifestSha &&
    sha256Hex(encodeEntities(store.get())) === state.lastPush.entitiesSha;
  const pushed = unchanged ? null : await pushManifest(store.get(), deps);
  throwIfAborted(deps.signal);
  const { deviceId } = await deps.transport.me(deps.signal);
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
    },
  };
  delete result.lastError;
  writeBase(merged.base);
  writeRemoteState(result);
  // 只收本次处理的清单钉子（含上次中断的同一份）；其他中断钉子按既有七天期限收拾。
  const completed = new Set(manifests.map((m) => m.index.sha256));
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

/** 退出不需要打开本机库；可离线退出，但服务拒绝删除时先保留本机钥匙。 */
export async function leaveFamily(
  deps: Pick<EngineDeps, "transport" | "signal">,
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
  await forgetKey();
  clearSyncFiles();
  return { removedRemote };
}
