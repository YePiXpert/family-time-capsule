/**
 * 几台手机一起同步的纯内存模拟（不碰磁盘不碰网络），照真实引擎的做法：
 * - 只读别人变过的清单（seen）；自己发出去的内容没变就不再发布；
 * - 每台手机有自己的时钟偏差；新版手机的改动走 stampChanges（与 LocalStore.change 同一个函数），
 *   1.1.6 手机不盖时刻、改人物名沿用原来的 updatedAt（editEntity 的深拷贝）；
 * - 同一轮可以拆成「读清单」和「合并＋发布」两步，模拟几台手机同时同步。
 * 家人同步的收敛测试与随机测试共用。
 */
import { canonical } from "../../src/local/hash";
import {
  PROFILE_FIELDS,
  diffLibrary,
  emptyLibrary,
  forkLibrary,
  rootValue,
  stampChanges,
  validateLibrary,
  type Library,
  type LocalRecord,
} from "../../src/local/model";
import {
  emptyBase,
  mergeLibraries,
  type RemoteSnapshot,
  type SyncBase,
} from "../../src/sync/merge";
import { mergeLibraries as mergeOld } from "./merge-1.1.6";

export const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export type Phone = {
  name: string;
  /** 还是 1.1.6：合并用 be98c2e 那一版，改动不盖时刻，发布的库根里没有 rootStamps。 */
  old: boolean;
  lib: Library;
  base: SyncBase;
  seen: Record<string, number>;
  /** 时钟偏差（毫秒）。 */
  offset: number;
  lastPublished?: string;
  pending?: { reads: RemoteSnapshot[]; readVers: Record<string, number> };
  /** 每次同步后的库，恢复备份时从里面挑。 */
  history: Library[];
  /** 刚用新钥匙加入、头一轮合并还没成功（RemoteState.joining）。 */
  joining?: boolean;
  /** 头一回加入时本机的值盖过了家里已有的：应当永远是 0。 */
  joinViolations?: number;
};
export type Server = Record<string, { ver: number; createdAt: string; library: Library }>;

export const T0 = "2026-09-20T10:00:00.000Z";
let clock = Date.parse(T0);
export const resetClock = () => (clock = Date.parse(T0));
export const tick = (ms = 1000) => (clock += ms);
export const nowOf = (p: Phone) => new Date(clock + p.offset).toISOString();

/** 家人看得到的全部（含版本时刻）：发布与否按它判断。 */
const SHARED = ["records", "letters", "albums", "series", "persons", "profile", "yearNotes", "yearCovers", "yearPicks", "tombstones", "yearBooksBoundAt", "rootStamps"] as const;
export const sharedView = (lib: Library) =>
  canonical(Object.fromEntries(SHARED.map((k) => [k, (lib as unknown as Record<string, unknown>)[k] ?? null])));
/** 带版本的根值与人物（只看内容，不含时刻）：收敛检查用。 */
export const rootView = (lib: Library) =>
  canonical({
    profile: lib.profile,
    yearNotes: lib.yearNotes,
    yearCovers: lib.yearCovers,
    persons: Object.fromEntries(Object.entries(lib.persons).map(([id, p]) => [id, p.name])),
  });
/** 记录（只看内容，不含时刻、世系、草稿计数）。 */
export const recordView = (lib: Library) =>
  canonical(Object.fromEntries(Object.entries(lib.records).map(([id, r]) => [id, { t: r.text, f: r.first }])));
export const contentView = (lib: Library) => `${rootView(lib)}\n${recordView(lib)}`;

export function phone(name: string, lib: Library, old = false, offset = 0): Phone {
  return { name, old, lib: copy(lib), base: emptyBase(), seen: {}, offset, history: [copy(lib)] };
}
/** 发布：1.1.6 手机的库根没有 rootStamps（它的 PUBLISHED_ROOT 不认这个键）。 */
function publish(p: Phone, server: Server): boolean {
  const view = sharedView(p.lib);
  if (p.lastPublished === view && server[p.name]) return false;
  p.lastPublished = view;
  const ver = (server[p.name]?.ver ?? 0) + 1;
  const library = copy(p.lib);
  if (p.old) delete library.rootStamps;
  server[p.name] = { ver, createdAt: nowOf(p), library };
  p.seen[p.name] = ver;
  return true;
}
/** 第一步：读变过的清单。 */
export function begin(p: Phone, server: Server) {
  const reads: RemoteSnapshot[] = [];
  const readVers: Record<string, number> = {};
  for (const [device, m] of Object.entries(server)) {
    if (p.seen[device] === m.ver) continue;
    reads.push({ deviceId: device, deviceName: device, createdAt: m.createdAt, library: copy(m.library) });
    readVers[device] = m.ver;
  }
  p.pending = { reads, readVers };
}
/** 第二步：并进当前的库（这之间本机可能又改过）、记下新基、需要时发布。 */
export function end(p: Phone, server: Server) {
  const { reads, readVers } = p.pending!;
  p.pending = undefined;
  const merge = p.old ? (mergeOld as unknown as typeof mergeLibraries) : mergeLibraries;
  const joining = !!p.joining && !p.old;
  const r = merge(p.lib, reads, p.base, nowOf(p), { joining });
  validateLibrary(r.next);
  // 头一回加入：家里有的资料字段与封面，并完之后一定是家里的某一版（本机加入前填的不算数）。
  if (joining)
    for (const id of [...PROFILE_FIELDS.map((f) => `profile:${f}`), ...Object.keys(r.next.yearCovers).map((y) => `yearCovers:${y}`)]) {
      const family = reads.filter((x) => x.library.rootStamps?.[id] !== undefined || ![undefined, null, ""].includes(rootValue(x.library, id) as string));
      if (family.length && !family.some((x) => rootValue(x.library, id) === rootValue(r.next, id)))
        p.joinViolations = (p.joinViolations ?? 0) + 1;
    }
  p.lib = copy(r.next);
  p.base = r.base;
  p.joining = false;
  Object.assign(p.seen, readVers);
  const published = publish(p, server);
  p.history.push(copy(p.lib));
  return { pulled: r.pulled, published, conflicts: r.conflicts.length };
}
export function sync(p: Phone, server: Server) {
  begin(p, server);
  const r = end(p, server);
  tick();
  return r;
}
/** 这一轮读了清单却没并成（断网、被杀）：什么都不留下，加入标记也还在。 */
export function abort(p: Phone) {
  p.pending = undefined;
}
/** 用新钥匙加入一个家（joinFamily 清掉同步文件并记下「头一回加入」）。 */
export function join(p: Phone) {
  p.base = emptyBase();
  p.seen = {};
  p.lastPublished = undefined;
  p.joining = true;
}
/** 换成一份备份：合并历史与已读清单都忘掉（forgetMergeHistory）。 */
export function restore(p: Phone, backup: Library) {
  p.lib = copy(backup);
  p.base = emptyBase();
  p.seen = {};
}
/** 升级前做的备份：没有任何版本时刻。 */
export function unstamped(lib: Library): Library {
  const out = copy(lib);
  delete out.rootStamps;
  for (const p of Object.values(out.persons)) delete (p as { updatedAt?: string }).updatedAt;
  return out;
}
/**
 * 界面上的一次改动。新版手机与 LocalStore.change 一样盖时刻；1.1.6 手机不盖。
 * fn 只能整个替换实体（editEntity 或新对象），和真实的 change 一样。
 */
export function edit(p: Phone, fn: (lib: Library) => void) {
  const prev = p.lib;
  const next = forkLibrary(prev);
  fn(next);
  if (!p.old) stampChanges(prev, next, diffLibrary(prev, next), nowOf(p));
  validateLibrary(next);
  p.lib = copy(next);
}
export const setName = (p: Phone, name: string) =>
  edit(p, (l) => { l.profile = { ...l.profile, name }; });
export const setMotto = (p: Phone, motto: string | undefined) =>
  edit(p, (l) => {
    const profile = { ...l.profile };
    if (motto === undefined) delete profile.motto;
    else profile.motto = motto;
    l.profile = profile;
  });
export const setAvatar = (p: Phone, avatarId: string | null) =>
  edit(p, (l) => { l.profile = { ...l.profile, avatarId }; });
/** 年度寄语：清空就删掉这一年（与年度页一样）。 */
export const setNote = (p: Phone, year: string, text: string) =>
  edit(p, (l) => {
    if (text) l.yearNotes[year] = text;
    else delete l.yearNotes[year];
  });
export const setCover = (p: Phone, year: string, mediaId: string) =>
  edit(p, (l) => { l.yearCovers[year] = mediaId; });
/** 改人物名：与 renamePerson 一样深拷贝后改 name（1.1.6 也是这样，原来的 updatedAt 跟着走）。 */
export const renamePerson = (p: Phone, id: string, name: string) =>
  edit(p, (l) => {
    if (l.persons[id]) l.persons[id] = { ...copy(l.persons[id]!), name };
  });
export const record = (id: string, text: string, at = T0): LocalRecord => ({
  id, revision: 1, updatedAt: at, title: "", text, date: at, location: "", first: false, mediaIds: [], coverId: null,
});
export const photo = (id: string, hex: string) => ({
  id, file: `${id}.jpg`, name: `${id}.jpg`, kind: "image" as const, bytes: 1, sha256: hex.repeat(64),
});
export function seedLib(fill: (s: Library) => void): Library {
  const lib = emptyLibrary();
  lib.welcome = true;
  fill(lib);
  return lib;
}
/**
 * 大家轮流同步，直到连续两轮谁也没拉到、谁也没发布；返回用了几轮，停不下来返回 -1。
 */
export function settle(phones: Phone[], server: Server, max = 15): number {
  let quiet = 0;
  for (let round = 0; round < max; round++) {
    let busy = false;
    for (const p of phones) {
      if (p.pending) end(p, server);
      const r = sync(p, server);
      if (r.pulled || r.published) busy = true;
    }
    if (!busy) {
      if (++quiet >= 2) return round;
    } else quiet = 0;
  }
  return -1;
}
