import { File } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { REMOTE_KEY_ITEM } from "../local/brand";
import { syncDirectory, syncManifestFile } from "../local/files";
import { keyFromHex, keyToHex } from "./crypto";
import {
  CONFLICT_KINDS,
  KNOWN_LIMIT,
  emptyBase,
  type Conflict,
  type SyncBase,
} from "./merge";
export { syncDirectory } from "../local/files";
export { KNOWN_LIMIT, emptyBase, type Conflict, type SyncBase } from "./merge";
/**
 * 家人一起写的本机状态，三个小 JSON，都在 documents/anan-v1/sync/ 下，都不进 Library
 * （备份里不该带着「我在哪台服务上、见过谁的清单」）；主密钥本体只在系统钥匙串。
 * - state.json：加没加入、钥匙指纹、上次同步、见过的清单、自动同步开关。
 * - base.json：上次同步后各共享实体的指纹与「已经见过的其他版本」，合并的三方之基。
 * - conflicts.json：两台手机都改过时输的那一版，书架冲突卡从这里读。
 */
export type SyncSummary = {
  /** 服务上有清单的手机数（含本机）。 */
  devices: number;
  /** 本机清单登记的对象数与总字节（素材 + 清单）。 */
  objects: number;
  bytes: number;
  /** 这一次从别人那里并入了几条、往远端新传了几个对象、新记了几条冲突。 */
  pulled: number;
  pushed: number;
  conflicts: number;
  /** 这一次没读成的手机数（它在远端的那份缺了或对不上），下次同步再试。 */
  unread?: number;
};
export type RemoteState = {
  version: 2;
  /** 已加入（钥匙在手、参与同步）；退出时整份状态删除，所以 false 只出现在「暂停」这种过渡态。 */
  enabled: boolean;
  keyId: string;
  joinedAt: string;
  /** 回到应用、保存之后自动同步；默认开。 */
  autoSync: boolean;
  /** 推送成功后确认的本机设备 ID；退出时不能用可能回退到其他手机的清单推断。 */
  deviceId?: string;
  /** 每台设备上次并入的清单 sha256（索引里的 sha）：清单没变就不再下载。 */
  seen: Record<string, string>;
  /** 上次成功发布的实体段与整份清单指纹；内容未变时免于重传。 */
  lastPush?: { entitiesSha: string; manifestSha: string };
  lastSyncAt?: string;
  lastSyncSummary?: SyncSummary;
  lastError?: string;
  /**
   * 刚用一把新钥匙加入、还没成功并入过家人：合并按「头一回加入」来——家里已有的根值（名字、格言、寄语…）
   * 听家里的，本机只补家里没有的。第一轮合并落进本机库后才去掉；中途失败、应用被杀，下次照样按加入来。
   */
  joining?: true;
};
/** 有手机这一轮没读成时的一句提示；都读到了就是空串。 */
export function unreadNotice(summary: SyncSummary | undefined): string {
  const n = summary?.unread ?? 0;
  return n > 0
    ? `有 ${n} 台手机的内容这次没读到（它在远端的那份缺了或对不上），下次同步会再试。`
    : "";
}
/** Build 70／71 的远端备份状态：读到就升成 v2。 */
type RemoteStateV1 = {
  version: 1;
  enabled: boolean;
  keyId: string;
  lastBackupAt?: string;
  lastBackupBytes?: number;
  lastBackupObjects?: number;
  lastError?: string;
};
const syncFileListeners = new Set<() => void>();
export function subscribeSyncFiles(fn: () => void): () => void {
  syncFileListeners.add(fn);
  return () => { syncFileListeners.delete(fn); };
}
function notifySyncFiles(): void {
  for (const fn of syncFileListeners) fn();
}
const stateFile = () => new File(syncDirectory, "state.json");
const baseFile = () => new File(syncDirectory, "base.json");
const conflictsFile = () => new File(syncDirectory, "conflicts.json");
const KEY_ID = /^[a-f0-9]{16}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const isTime = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
/** 刚加入时的状态。 */
export const freshRemoteState = (
  keyId: string,
  now: string = new Date().toISOString(),
): RemoteState => ({
  version: 2,
  enabled: true,
  keyId,
  joinedAt: now,
  autoSync: true,
  seen: {},
});
function upgradeState(v1: RemoteStateV1, now: string): RemoteState {
  const at = isTime(v1.lastBackupAt) ? v1.lastBackupAt : undefined;
  return {
    ...freshRemoteState(v1.keyId, at ?? now),
    enabled: v1.enabled,
    ...(at ? { lastSyncAt: at } : {}),
    ...(typeof v1.lastBackupBytes === "number"
      ? {
          lastSyncSummary: {
            devices: 1,
            objects: v1.lastBackupObjects ?? 0,
            bytes: v1.lastBackupBytes,
            pulled: 0,
            pushed: 0,
            conflicts: 0,
          },
        }
      : {}),
    ...(typeof v1.lastError === "string" ? { lastError: v1.lastError } : {}),
  };
}
async function readJson(file: File): Promise<unknown> {
  const parse = async (f: File) => {
    try {
      return JSON.parse(await f.text()) as unknown;
    } catch {
      return null;
    }
  };
  if (file.exists) return parse(file);
  // writeJson 先删旧文件再换名：中间被打断时，完整的新内容只在 .part 里。
  const part = new File(syncDirectory, `${file.name}.part`);
  return part.exists ? parse(part) : null;
}
/** 读不出、认不得的状态文件一律当作「没加入」：不让一份坏 JSON 把同步卡死。 */
export async function readRemoteState(
  now: string = new Date().toISOString(),
): Promise<RemoteState | null> {
  const raw = await readJson(stateFile());
  if (!raw || typeof raw !== "object") return null;
  const parsed = raw as Record<string, unknown>;
  if (
    typeof parsed.enabled !== "boolean" ||
    typeof parsed.keyId !== "string" ||
    !KEY_ID.test(parsed.keyId)
  )
    return null;
  if (parsed.version === 1)
    return upgradeState(parsed as unknown as RemoteStateV1, now);
  if (parsed.version !== 2) return null;
  const seen: Record<string, string> = {};
  if (parsed.seen && typeof parsed.seen === "object")
    for (const [device, sha] of Object.entries(parsed.seen))
      if (typeof sha === "string") seen[device] = sha;
  const summary = parsed.lastSyncSummary;
  const push = parsed.lastPush as
    | Partial<NonNullable<RemoteState["lastPush"]>>
    | null;
  const lastPush =
    push &&
    typeof push.entitiesSha === "string" &&
    SHA256.test(push.entitiesSha) &&
    typeof push.manifestSha === "string" &&
    SHA256.test(push.manifestSha)
      ? { entitiesSha: push.entitiesSha, manifestSha: push.manifestSha }
      : undefined;
  return {
    version: 2,
    enabled: parsed.enabled,
    keyId: parsed.keyId,
    joinedAt: isTime(parsed.joinedAt) ? parsed.joinedAt : now,
    autoSync: parsed.autoSync !== false,
    seen,
    ...(lastPush ? { lastPush } : {}),
    ...(typeof parsed.deviceId === "string"
      ? { deviceId: parsed.deviceId }
      : {}),
    ...(isTime(parsed.lastSyncAt) ? { lastSyncAt: parsed.lastSyncAt } : {}),
    ...(summary && typeof summary === "object"
      ? { lastSyncSummary: summary as SyncSummary }
      : {}),
    ...(typeof parsed.lastError === "string"
      ? { lastError: parsed.lastError }
      : {}),
    ...(parsed.joining === true ? { joining: true as const } : {}),
  };
}
/** 先写 .part 再同步换名：断电也不会留下半个 JSON，返回时新内容已经在位（异步 move 会让紧接着的读看到「没有」）。 */
function writeJson(file: File, value: unknown): void {
  syncDirectory.create({ intermediates: true, idempotent: true });
  const part = new File(syncDirectory, `${file.name}.part`);
  if (part.exists) part.delete();
  part.create();
  part.write(JSON.stringify(value));
  if (file.exists) file.delete();
  part.moveSync(file);
  notifySyncFiles();
}
export function writeRemoteState(state: RemoteState): void {
  writeJson(stateFile(), state);
}
export function clearRemoteState(): void {
  const file = stateFile();
  if (file.exists) file.delete();
  notifySyncFiles();
}
const isStringMap = (value: unknown): value is Record<string, string> =>
  !!value &&
  typeof value === "object" &&
  Object.values(value).every((v) => typeof v === "string");
/** 坏掉或缺失的基 = 空基：合并会退化成按时间新者胜，且内容相同不算冲突，不会丢字。 */
export async function readBase(): Promise<SyncBase> {
  const parsed = (await readJson(baseFile())) as Partial<SyncBase> | null;
  if (!parsed || parsed.version !== 1) return emptyBase();
  const base = emptyBase();
  if (parsed.merged && typeof parsed.merged === "object")
    for (const [kind, ids] of Object.entries(parsed.merged))
      if (isStringMap(ids)) base.merged[kind] = { ...ids };
  if (parsed.known && typeof parsed.known === "object")
    for (const [key, list] of Object.entries(parsed.known))
      if (Array.isArray(list) && list.every((v) => typeof v === "string"))
        base.known[key] = list.slice(-KNOWN_LIMIT);
  return base;
}
export function writeBase(base: SyncBase): void {
  writeJson(baseFile(), base);
}
/**
 * 本机库被整份换掉（恢复了一份备份）：基与已读清单描述的都不再是这台手机上的东西。
 * 清掉后下一轮把全家的清单重读一遍、按版本世系并回来；否则这台手机会停在备份那一刻，跟家人各执一版。
 */
export async function forgetMergeHistory(): Promise<void> {
  const base = baseFile();
  if (base.exists) base.delete();
  const state = await readRemoteState();
  if (state) writeRemoteState({ ...state, seen: {} });
  else notifySyncFiles();
}
function conflictOf(value: unknown): Conflict | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  const loser = c.loser as Record<string, unknown> | undefined;
  if (
    typeof c.key !== "string" ||
    !CONFLICT_KINDS.includes(c.kind as Conflict["kind"]) ||
    typeof c.entityId !== "string" ||
    !isTime(c.at) ||
    !(c.device === null || typeof c.device === "string") ||
    !c.winner ||
    typeof c.winner !== "object" ||
    !isTime((c.winner as Record<string, unknown>).updatedAt) ||
    !loser ||
    typeof loser !== "object" ||
    loser.id !== c.entityId
  )
    return null;
  return c as unknown as Conflict;
}
/** 坏掉的冲突文件当作没有冲突：书架少一张卡，总好过打不开。 */
export async function readConflicts(): Promise<Conflict[]> {
  const parsed = (await readJson(conflictsFile())) as {
    version?: number;
    items?: unknown[];
  } | null;
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.items))
    return [];
  const out: Conflict[] = [];
  for (const item of parsed.items) {
    const c = conflictOf(item);
    if (c) out.push(c);
  }
  return out;
}
export function writeConflicts(items: readonly Conflict[]): void {
  writeJson(conflictsFile(), { version: 1, items });
}
/**
 * 退出一起写：状态、基与同步清单一起删；本机资料一个字节不动。
 * 冲突留底不删：那是没选中的一版唯一的副本，退出、换钥匙加入之后照样可以「用这一版」。
 */
export function clearSyncFiles(): void {
  for (const file of [stateFile(), baseFile(), syncManifestFile()])
    if (file.exists) file.delete();
  notifySyncFiles();
}
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export async function loadKey(): Promise<Uint8Array | null> {
  const hex = await SecureStore.getItemAsync(REMOTE_KEY_ITEM);
  if (hex === null) return null;
  try {
    return keyFromHex(hex);
  } catch {
    return null;
  }
}
export const storeKey = (key: Uint8Array) =>
  SecureStore.setItemAsync(REMOTE_KEY_ITEM, keyToHex(key), options);
export const forgetKey = () => SecureStore.deleteItemAsync(REMOTE_KEY_ITEM);
