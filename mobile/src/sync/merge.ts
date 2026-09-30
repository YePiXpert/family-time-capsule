import { mergeHistory, historyMedia } from "../local/history";
import { contentHashOf, hashOf, lineage } from "../local/hash";
import {
  PROFILE_FIELDS,
  ROOT_STAMP_KEY,
  TOMBSTONE_KINDS,
  deletePerson,
  editEntity,
  forkLibrary,
  mergePersons,
  nextStamp,
  rootValue,
  type Library,
  type LocalAlbum,
  type LocalLetter,
  type LocalMedia,
  type LocalPerson,
  type LocalRecord,
  type LocalSeries,
  type ProfileField,
  type Stored,
  type TombstoneKind,
} from "../local/model";
export { canonical, contentHashOf, hashOf } from "../local/hash";
/**
 * 家人一起写的合并：纯函数，不碰磁盘不碰网络。输入本机库、别人的清单（整库快照）与上次同步之基，
 * 输出合并后的库、新记的冲突、要去下载的素材与新的基。任何一步都不改传入的对象。
 *
 * 逐实体（records／albums／series／letters／persons）三方合并，基是两样东西：
 * - merged：上次同步结束时本机每个实体的指纹。本机指纹 = 它 → 本机这一段没动过。
 * - known：本机已经处理过的其他版本（曾持有、曾判输、曾判过时）。别人的清单是整库快照，
 *   输掉的旧版会一直躺在里面，认得它们才不会把删掉、改掉的东西送回来，也不会反复出同一张冲突卡。
 * 规则：远端版本与本机相同、与基相同或已认得 → 不看；世系先说话：远端接着本机改的 → 取远端（哪怕时钟慢），
 * 远端早在本机世系里 → 不动。其余：本机没动 → 取远端（远端比本机还旧的除外：
 * 留本机、出冲突卡；远端有世系但不源自本机版时，本机输掉的一版也留底）；两边都动 → 按 updatedAt 新者胜、同秒比内容哈希，输的一版留底；内容相同不算冲突。
 * 墓碑：删除时刻晚于实体 updatedAt → 删（本机改过又被删也留底）；实体在墓碑之后改过 → 改者胜。
 * 相册／系列两边都动：名字随赢家，条目取并集（赢家在前）；人物同名自动并成一个（id 小的留下）。
 * 人物的 updatedAt 是改名时刻（LocalStore.change 盖）：没有的（1.1.6 建的、升级前的）比有的旧；并进来的一版
 * 不比本机新却换了名字（1.1.6 改名不动 updatedAt）就盖上新时刻。
 * 根值带版本（rootStamps：资料各字段、每年的寄语与封面各一个改动时刻），见 mergeVersionedRoot：带时刻的按
 * （时刻，内容指纹）全序取最新，改回见过的值、清空都传得开，旧快照传不开，谁也不来回翻；同时写的寄语照旧接起来。
 * 没有时刻的（1.1.6 手机、升级前）按原来的规则并，并进来就盖上时刻。选片（yearPicks）自带 updatedAt，照旧。
 * base.merged 仍只记值的指纹，旧的 base.json 照样能用。头一回加入（options.joining）见 MergeOptions、joinRoot。
 * 素材按 id 取并集、本机已有的永不被覆盖，只带回合并后共享实体引用到的那些。
 */
export type RemoteSnapshot = {
  deviceId: string;
  deviceName: string | null;
  /** 清单的 createdAt：同一素材出现在多份清单里时，优先找较新的那份。 */
  createdAt: string;
  library: Library;
};
export type MergeResult = {
  next: Library;
  /** 这一次新记下的冲突（同一实体只一条）；旧的由调用方合并。 */
  conflicts: Conflict[];
  /** 从别人那里并进来、本机还没有文件的素材（thumb 已去掉，物化后再补）。 */
  wantedMedia: Stored<LocalMedia>[];
  base: SyncBase;
  /** 并入了几处：实体取用／删除 + 根字段变化。 */
  pulled: number;
};
/**
 * 合并之基。merged：上次同步结束时本机库里每个共享实体的指纹（kind → id → 指纹；根字段以 "root" 为 kind），
 * 与它相同 = 「本机这一段没动过」。known：每个实体本机已经处理过的其他版本——曾持有、曾判输、曾判过时——
 * 别人的清单是整库快照，输掉的旧版会一直躺在里面，认得它们才不会把删掉、改掉的东西送回来。
 */
export type SyncBase = {
  version: 1;
  merged: Record<string, Record<string, string>>;
  known: Record<string, string[]>;
};
/** 每个实体最多记这么多枚见过的指纹；改动本来就少，超过就丢最旧的。 */
export const KNOWN_LIMIT = 32;
export const emptyBase = (): SyncBase => ({
  version: 1,
  merged: {},
  known: {},
});
/** 一段时光或一封信的另一版：两台手机都改过时输的那一版，留着可换回。 */
export type Conflict = {
  /** "kind:id"；同一实体只留最新一次冲突。 */
  key: string;
  kind: "records" | "letters";
  entityId: string;
  /** 记下冲突的时刻（同步时刻）。 */
  at: string;
  /** 输的一版来自哪台手机；输的是本机这一版时为 null。 */
  device: string | null;
  /** 赢的一版的时间与落款，卡片上对照用；deleted = 赢的是对方的删除（updatedAt 是删除时刻）。 */
  winner: { updatedAt: string; by?: string; deleted?: true };
  /** 输的一版全文，「用这一版」时作为新一版重新保存。 */
  loser: LocalRecord | LocalLetter;
};
export const CONFLICT_KINDS = ["records", "letters"] as const;
export const SHARED_KINDS: readonly TombstoneKind[] = TOMBSTONE_KINDS;
type SharedKind = TombstoneKind;
type Shared = { id: string; updatedAt?: string; ancestors?: readonly string[] };
/** 未带世系的旧版本无法判断因果关系；升级期不据此出卡。 */
function descendsFrom(candidate: Shared, local: Shared): boolean | undefined {
  const line = candidate.ancestors;
  if (!Array.isArray(line)) return undefined;
  const hash = contentHashOf(local).slice(0, 16);
  if (!line.includes(hash)) return false;
  // local 是改回去的一版（取消了「第一次」，内容等于它自己的某个祖先）：同一枚哈希分不清指的是它还是它的祖先。
  // 这时要整条接得上——candidate 在那一位之后的世系正是 local 的世系（lineage 同样截到八枚）。
  const own = local.ancestors ?? [];
  if (!own.includes(hash)) return true;
  return line.some((h, i) => {
    if (h !== hash) return false;
    const tail = line.slice(i + 1),
      expected = own.slice(0, 7 - i);
    return tail.length === expected.length && tail.every((x, j) => x === expected[j]);
  });
}
type Version = { fp: string; entity: Shared; device: string | null };
/**
 * 远端版对本机版的因果：descendant = 远端接着本机改的（后代永远不过时：时钟慢的手机接着改的一版、
 * 改回去的一版都照收）；ancestor = 远端早已包含在本机里；concurrent = 两边都有世系、互不相干；unknown = 旧版本没有世系。
 * 世系截到八枚又改回去过时，两边可能互相认得：按新者胜。
 */
function relationOf(
  remote: Version,
  local: Version,
): "descendant" | "ancestor" | "concurrent" | "unknown" {
  const down = descendsFrom(remote.entity, local.entity),
    up = descendsFrom(local.entity, remote.entity);
  if (down && up) return newest(remote, local) < 0 ? "descendant" : "ancestor";
  if (down) return "descendant";
  if (up) return "ancestor";
  return down === false ? "concurrent" : "unknown";
}
/** JSON 值逐项相等（键序不论）。说「不等」可能是假的（undefined 键、NaN），说「相等」一定真。 */
function equalValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => equalValue(x, b[i]))
    );
  const ka = Object.keys(a),
    kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every(
      (k) =>
        Object.prototype.hasOwnProperty.call(b, k) &&
        equalValue(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    )
  );
}
/** 远端这一版和本机的只差草稿计数与世系：指纹必然相同，不必再哈希（没有 JIT 的手机上哈希很贵）。 */
function sameVersion(remote: Shared, local: Shared): boolean {
  const { revision: _r1, ancestors: _a1, ...r } = remote as Record<string, unknown>;
  const { revision: _r2, ancestors: _a2, ...l } = local as Record<string, unknown>;
  return equalValue(r, l);
}
/** 实体指纹 "updatedAt|内容哈希"；没有 updatedAt 的（人物）前半为空。 */
export function fingerprintOf(entity: Shared): string {
  return `${entity.updatedAt ?? ""}|${contentHashOf(entity)}`;
}
const hashPart = (fp: string) => fp.slice(fp.indexOf("|") + 1);
const timeOf = (e: Shared) =>
  e.updatedAt === undefined ? NaN : Date.parse(e.updatedAt);
/**
 * 新者在前：先比 updatedAt，再比内容哈希——两台手机对同两版算出同一个赢家。没有 updatedAt 的
 * （1.1.6 手机建的人物、升级前的旧人物）比有的旧：这样才是全序，几台手机对同一堆版本排出同一个最新。
 */
function newest(a: Version, b: Version): number {
  const ta = timeOf(a.entity),
    tb = timeOf(b.entity);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
  if (Number.isFinite(ta) !== Number.isFinite(tb)) return Number.isFinite(ta) ? -1 : 1;
  return hashPart(b.fp).localeCompare(hashPart(a.fp));
}
/** a 比 b 旧：时刻更早，或 a 没有时刻而 b 有（只有人物会缺）。 */
const isOlder = (a: Shared, b: Shared) => {
  const ta = timeOf(a),
    tb = timeOf(b);
  return Number.isFinite(tb) && (Number.isFinite(ta) ? ta < tb : true);
};
/** 墓碑压得住这一版吗：删除时刻晚于它的 updatedAt；没有 updatedAt 的（旧人物）一律压得住。 */
const deadBy = (deletedAt: string | undefined, e: Shared) =>
  deletedAt !== undefined &&
  (e.updatedAt === undefined || Date.parse(deletedAt) > timeOf(e));
const collection = (lib: Library, kind: SharedKind) =>
  lib[kind] as unknown as Record<string, Shared>;
const byOf = (kind: SharedKind, e: Shared): string | undefined =>
  kind === "records"
    ? (e as Stored<LocalRecord>).by
    : kind === "letters"
      ? (e as Stored<LocalLetter>).from || undefined
      : undefined;
/** 并集：first 的顺序在前，second 里新的键追加在后。 */
export function unionItems<T>(
  first: readonly T[],
  second: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  const seen = new Set(first.map(keyOf));
  const out = [...first];
  for (const item of second) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
const sameName = (a: Stored<LocalPerson>, b: Stored<LocalPerson>) =>
  a.name.trim() === b.name.trim();
/** 同名人物并成一个：id 小的留下，标记改写到它身上；两台手机各自算也得出同一个幸存者。 */
export function unifyPersons(s: Library, now: string): number {
  const groups = new Map<string, string[]>();
  for (const p of Object.values(s.persons)) {
    const name = p.name.trim();
    groups.set(name, [...(groups.get(name) ?? []), p.id]);
  }
  let merged = 0;
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const [target, ...rest] = ids.sort((a, b) => a.localeCompare(b));
    for (const source of rest) {
      mergePersons(s, source, target!, now);
      merged++;
    }
  }
  return merged;
}
/** 删一个人物：库里还有同名的就并过去（标记不丢），没有才剥掉标记。 */
function removePerson(s: Library, id: string, deletedAt: string): void {
  const gone = s.persons[id];
  if (!gone) return;
  const twin = Object.values(s.persons).find(
    (p) => p.id !== id && sameName(p, gone),
  );
  if (twin) mergePersons(s, id, twin.id, deletedAt);
  else deletePerson(s, id, deletedAt);
}
type RootId = string;
/** 根字段拆成小块各自合并：资料按字段一块，年度寄语／年度封面按年一块。 */
/** 发给家人的库根（宝宝资料、年度寄语、封面、选片），键排好；本机设置等不在其中。 */
export function sharedRootOf(lib: Library): Record<string, unknown> {
  return Object.fromEntries(rootIds(lib).map((id) => [id, rootValue(lib, id)]));
}
function rootIds(lib: Library): RootId[] {
  return [
    ...PROFILE_FIELDS.map((f) => `profile:${f}`),
    ...Object.keys(lib.yearNotes).map((y) => `yearNotes:${y}`),
    ...Object.keys(lib.yearCovers).map((y) => `yearCovers:${y}`),
    ...Object.keys(lib.yearStories ?? {}).map((y) => `yearStories:${y}`),
    ...Object.keys(lib.yearPicks ?? {}).map((y) => `yearPicks:${y}`),
  ];
}
function setRoot(lib: Library, id: RootId, value: unknown): void {
  if (id.startsWith("profile:")) {
    const profile: Record<string, unknown> = { ...lib.profile };
    if (value === undefined) delete profile[id.slice(8)];
    else profile[id.slice(8)] = value;
    lib.profile = profile as Library["profile"];
    return;
  }
  const [field, year] = id.split(":") as ["yearNotes" | "yearCovers" | "yearPicks" | "yearStories", string];
  if (field === "yearStories") {
    lib.yearStories = { ...lib.yearStories };
    if (value === undefined) delete lib.yearStories[year];
    else lib.yearStories[year] = value as NonNullable<Library["yearStories"]>[string];
    return;
  }
  if (field === "yearPicks") {
    if (value === undefined) {
      if (lib.yearPicks) {
        delete lib.yearPicks[year];
        if (!Object.keys(lib.yearPicks).length) delete lib.yearPicks;
      }
    } else lib.yearPicks = { ...lib.yearPicks, [year]: value as NonNullable<Library["yearPicks"]>[string] };
    return;
  }
  if (value === undefined) delete lib[field][year];
  else lib[field][year] = value as string;
}
const isBlank = (value: unknown) =>
  value === undefined || value === null || value === "";
const rootFp = (value: unknown) => (value === undefined ? "-" : hashOf(value));
/** 多台都改了同一年的寄语：谁都不丢，赢家在前、另一段接在后面；一段已包含另一段时取长的。 */
function joinNotes(winner: string, loser: string): string {
  if (winner.includes(loser)) return winner;
  if (loser.includes(winner)) return loser;
  return `${winner}\n\n${loser}`;
}
/**
 * 引用整理：合并可能带来指向已删记录的相册条目、指向已并人物的标记、没人有文件的素材引用。
 * 校验要求引用都落到实处，这里按「少一个引用」而不是「整库拒绝」处理。
 */
export function repairReferences(s: Library): void {
  // 目录只在真的少了引用时才换对象：没变的年份保留引用，草稿保存与合并结果才不会被当成共享改动。
  for (const [year, picks] of Object.entries(s.yearPicks ?? {})) {
    let changed = false;
    const months: typeof picks.months = {};
    for (const [month, entry] of Object.entries(picks.months)) {
      const recordIds = entry.recordIds.filter((id) => !!s.records[id]);
      const quoteOk = !entry.quote || !!s.records[entry.quote.recordId];
      if (recordIds.length === entry.recordIds.length && quoteOk) {
        months[month] = entry;
        continue;
      }
      changed = true;
      if (!recordIds.length) continue;
      months[month] = { recordIds, ...(entry.quote && quoteOk ? { quote: entry.quote } : {}) };
    }
    if (changed)
      setRoot(s, `yearPicks:${year}`, Object.keys(months).length ? { ...picks, months } : undefined);
  }
  const mediaOk = (id: string) => !!s.media[id];
  const personOk = (id: string) => !!s.persons[id];
  const fixContent = (c: {
    mediaIds: string[];
    coverId: string | null;
    personIds?: string[];
  }) => {
    if (!c.mediaIds.every(mediaOk)) c.mediaIds = c.mediaIds.filter(mediaOk);
    if (c.coverId !== null && !c.mediaIds.includes(c.coverId)) c.coverId = null;
    if (c.personIds && !c.personIds.every(personOk)) {
      const kept = c.personIds.filter(personOk);
      if (kept.length) c.personIds = kept;
      else delete c.personIds;
    }
  };
  const contentBroken = (c: {
    mediaIds: readonly string[];
    coverId: string | null;
    personIds?: readonly string[];
  }) =>
    !c.mediaIds.every(mediaOk) ||
    (c.coverId !== null && !c.mediaIds.includes(c.coverId)) ||
    !(c.personIds ?? []).every(personOk);
  for (const [id, r] of Object.entries(s.records))
    if (contentBroken(r))
      editEntity(s, "records", id, (record) => {
        record.ancestors = lineage(record);
        fixContent(record);
      });
  for (const [id, d] of Object.entries(s.drafts))
    if (
      (d.recordId !== null && !s.records[d.recordId]) ||
      contentBroken(d.content)
    )
      editEntity(s, "drafts", id, (draft) => {
        // 正在改的那段被别人删了：草稿留着，改成一段新的时光，一个字不丢。
        if (draft.recordId !== null && !s.records[draft.recordId]) {
          draft.recordId = null;
          draft.baseRevision = 0;
        }
        fixContent(draft.content);
      });
  const recordHas = (recordId: string, mediaId: string | null) =>
    mediaId !== null && !!s.records[recordId]?.mediaIds.includes(mediaId);
  for (const [id, a] of Object.entries(s.albums))
    if (
      !a.items.every((i) => !!s.records[i.recordId]) ||
      (a.coverId !== null &&
        !a.items.some((i) => recordHas(i.recordId, a.coverId)))
    )
      editEntity(s, "albums", id, (album) => {
        album.items = album.items.filter((i) => !!s.records[i.recordId]);
        if (
          album.coverId !== null &&
          !album.items.some((i) => recordHas(i.recordId, album.coverId))
        )
          album.coverId = null;
      });
  for (const [id, q] of Object.entries(s.selections))
    if (
      !q.selected.every((r) => !!s.records[r]) ||
      (q.albumId !== null && !s.albums[q.albumId]) ||
      (q.coverId !== null && !q.selected.some((r) => recordHas(r, q.coverId)))
    )
      editEntity(s, "selections", id, (q) => {
        q.selected = q.selected.filter((r) => !!s.records[r]);
        if (q.albumId !== null && !s.albums[q.albumId]) q.albumId = null;
        if (
          q.coverId !== null &&
          !q.selected.some((r) => recordHas(r, q.coverId))
        )
          q.coverId = null;
      });
  // 系列里每条记录、每张照片只能出现一次：并集可能把同一条记录并进两个月份，先到的（赢家的）留下。
  const seriesItems = (items: readonly LocalSeries["items"][number][]) => {
    const records = new Set<string>(),
      photos = new Set<string>();
    return items.filter((i) => {
      if (
        !recordHas(i.recordId, i.mediaId) ||
        s.media[i.mediaId]?.kind !== "image" ||
        records.has(i.recordId) ||
        photos.has(i.mediaId)
      )
        return false;
      records.add(i.recordId);
      photos.add(i.mediaId);
      return true;
    });
  };
  for (const [id, t] of Object.entries(s.series))
    if (seriesItems(t.items).length !== t.items.length)
      editEntity(s, "series", id, (series) => {
        series.items = seriesItems(series.items);
      });
  for (const [id, l] of Object.entries(s.letters))
    if (
      !l.mediaIds.every(mediaOk) ||
      (l.coverId !== null && !l.mediaIds.includes(l.coverId))
    )
      editEntity(s, "letters", id, (letter) => {
        letter.ancestors = lineage(letter);
        letter.mediaIds = letter.mediaIds.filter(mediaOk);
        if (
          letter.coverId !== null &&
          !letter.mediaIds.includes(letter.coverId)
        )
          letter.coverId = null;
      });
  if (s.profile.avatarId && s.media[s.profile.avatarId]?.kind !== "image")
    s.profile = { ...s.profile, avatarId: null };
}
/** 合并后共享实体引用到的素材 id：只有这些才值得下载。 */
function referencedShared(s: Library): Set<string> {
  return new Set([
    ...(s.profile.avatarId ? [s.profile.avatarId] : []),
    ...Object.values(s.yearCovers),
    ...Object.values(s.records).flatMap((r) => [
      ...r.mediaIds,
      ...(r.coverId ? [r.coverId] : []),
    ]),
    ...Object.values(s.letters).flatMap((l) => [...l.mediaIds, ...historyMedia(l)]),
  ]);
}
type RootVersion = { value: unknown; fp: string; at?: string };
/** 这一块根值的时刻；读不出的当作没有（清单都校验过，这里只是不让一枚坏时刻排到最前）。 */
const stampOf = (lib: Library, id: RootId): string | undefined => {
  const at = lib.rootStamps?.[id];
  return typeof at === "string" && Number.isFinite(Date.parse(at)) ? at : undefined;
};
const stampTime = (v: RootVersion) =>
  v.at === undefined ? -Infinity : Date.parse(v.at);
/**
 * 带版本的根值新者在前：先比时刻（没有时刻的最旧），同一时刻比内容指纹。这是全序——
 * 每台手机对同一堆版本排出同一个最新，谁也不会来回翻。
 */
function newerRoot(a: RootVersion, b: RootVersion): number {
  const ta = stampTime(a),
    tb = stampTime(b);
  if (ta !== tb) return tb > ta ? 1 : -1;
  return a.fp === b.fp ? 0 : b.fp > a.fp ? 1 : -1;
}
const latestStamp = (versions: readonly RootVersion[]) =>
  versions.reduce<string | undefined>(
    (max, v) =>
      v.at !== undefined && (max === undefined || Date.parse(v.at) > Date.parse(max))
        ? v.at
        : max,
    undefined,
  );
/** 几段寄语按给定顺序接起来（赢家在前）；空的不算一段。都空就是第一版的值。 */
function joinVersions(versions: readonly RootVersion[]): unknown {
  let joined: string | undefined;
  for (const v of versions)
    if (typeof v.value === "string" && v.value !== "")
      joined = joined === undefined ? v.value : joinNotes(joined, v.value);
  return joined ?? versions[0]!.value;
}
/**
 * 一块带版本的根值（资料字段、某年寄语、某年封面）怎么并。version 为 undefined 表示本机不动；
 * seen 是这一轮看过的其他版本，记进 known。
 * - 带时刻的远端版本比本机新（全序 newerRoot）：取最新的。本机这一段也改过的年度寄语照旧接上，
 *   接好的一段时刻晚于参与的每一版，全家收敛到它。不看 known：改回去的值有新时刻，照样传开；
 *   旧快照时刻旧，自然不取。本机没有时刻（旧数据、恢复的旧备份）比任何带时刻的都旧。
 * - 没有更新的带时刻版本：没时刻的远端版本（1.1.6 手机、升级前的数据）按原来的规则
 *   （认得的不看，内容哈希定序，寄语接上）；并进来就盖上时刻，从此进入有版本的世界。
 *   没有基（恢复后、忘了合并历史；不是「这一项还没进过基」）时，本机或远端只要有带时刻的一版就不听没时刻的——分不清是新改动
 *   还是旧手机的旧快照，按「没有时刻的最旧」处理。
 */
function mergeVersionedRoot(
  id: RootId,
  local: Library,
  ordered: readonly RemoteSnapshot[],
  M: string | undefined,
  knownHere: ReadonlySet<string>,
  now: string,
  hasBase: boolean,
): { version?: RootVersion; seen: string[] } {
  const note = id.startsWith("yearNotes:");
  const localValue = rootValue(local, id);
  const mine: RootVersion = {
    value: localValue,
    fp: rootFp(localValue),
    at: stampOf(local, id),
  };
  // A pending automatic result on another phone cannot overwrite a family's edited story.
  if (id.startsWith("yearStories:")) {
    const versions = [mine, ...ordered.map((r) => ({ value: rootValue(r.library, id), fp: rootFp(rootValue(r.library, id)), at: stampOf(r.library, id) }))];
    const edited = versions.filter((v) => (v.value as { edited?: boolean } | undefined)?.edited);
    if (edited.length) {
      edited.sort((a, b) => newerRoot(a, b));
      const best = edited[0]!;
      return { version: best, seen: versions.map((v) => v.fp) };
    }
  }
  const stamped: RootVersion[] = [],
    plain: RootVersion[] = [];
  for (const r of ordered) {
    const value = rootValue(r.library, id),
      fp = rootFp(value),
      at = stampOf(r.library, id);
    if (at !== undefined) {
      if (!stamped.some((c) => c.fp === fp && c.at === at)) stamped.push({ value, fp, at });
      continue;
    }
    if (fp === mine.fp || fp === M || knownHere.has(fp)) continue;
    // 还没有基（头一回合并）时，空着的一项就是没填过，不算改动。
    if (M === undefined && isBlank(value)) continue;
    if (!plain.some((c) => c.fp === fp)) plain.push({ value, fp });
  }
  const seen = [...stamped, ...plain].map((c) => c.fp);
  if (!hasBase && (stamped.length || mine.at !== undefined)) plain.length = 0;
  const unseen = (c: RootVersion) => c.fp !== mine.fp && c.fp !== M && !knownHere.has(c.fp);
  // 本机这一段改过：只在有基时才说得清；没有基时本机那一版只是某个旧版本。有基、这一项却是新的（今年头一回写寄语）：写了就算改过。
  const changed = hasBase && mine.fp !== M && !(M === undefined && isBlank(localValue));
  const newer = stamped.filter((c) => newerRoot(c, mine) < 0).sort(newerRoot);
  const top = newer[0];
  if (top) {
    if (!note || !changed) return { version: top, seen };
    // 两边都改了同一年的寄语：谁都不丢。
    const parts = [top, ...[...stamped.filter((c) => c !== top && unseen(c)), ...plain].sort(newerRoot), mine];
    const value = joinVersions(parts);
    return {
      version: rootFp(value) === top.fp ? top : { value, fp: rootFp(value), at: nextStamp(latestStamp(parts), now) },
      seen,
    };
  }
  const concurrent = note && changed ? stamped.filter(unseen) : [];
  if (concurrent.length) {
    // 没有更新的一版，但有本机没见过的并发改动（时刻更早）：接在本机这段后面。
    const others = [...concurrent, ...plain].sort(newerRoot);
    const parts = [mine, ...others];
    const value = joinVersions(parts);
    const fp = rootFp(value);
    return fp === mine.fp ? { seen } : { version: { value, fp, at: nextStamp(latestStamp(parts), now) }, seen };
  }
  if (!plain.length) return { seen };
  // 没有时刻的改动：原来的规则。本机没动（或初次加入时没填）不参加竞争，单边删除仍能传过来。
  const candidates = [...plain];
  if (mine.fp !== M && !(M === undefined && isBlank(localValue))) candidates.push(mine);
  candidates.sort((a, b) => b.fp.localeCompare(a.fp));
  // 与 1.1.6 逐字相同：内容哈希定序，寄语按同一顺序接上（排第一的是删除时就删）。
  let value = candidates[0]!.value;
  if (note && typeof value === "string") {
    let joined = value;
    for (const c of candidates.slice(1))
      if (typeof c.value === "string") joined = joinNotes(joined, c.value);
    value = joined;
  }
  const fp = rootFp(value);
  if (fp === mine.fp) return { seen };
  // 并进来的值盖上时刻，晚于本机那一版；没有基时说不清它新不新，不盖（任何带时刻的版本都能再改掉它）。
  return {
    version: { value, fp, at: hasBase ? nextStamp(mine.at, now) : undefined },
    seen,
  };
}
/**
 * 头一回加入时一块根值怎么并（资料字段、某年寄语、某年封面）：只要有一台家人的清单有这一项
 * （有值，或带时刻的清空），本机的就不参加——取家里带时刻里最新的；家里都没时刻（1.1.6、升级前）就按原来的规则
 * 在家里的几版里挑（内容哈希定序，寄语接上），不盖时刻。寄语例外：本机这一年也写了，就接在家里那段后面，时刻晚于两边。
 * 家里没有这一项：本机补上，连同它的时刻。
 */
function joinRoot(
  id: RootId,
  local: Library,
  ordered: readonly RemoteSnapshot[],
  now: string,
): { version?: RootVersion; seen: string[] } {
  const family: RootVersion[] = [];
  for (const r of ordered) {
    const value = rootValue(r.library, id),
      at = stampOf(r.library, id);
    if (at === undefined && isBlank(value)) continue;
    const fp = rootFp(value);
    if (!family.some((c) => c.fp === fp && c.at === at)) family.push({ value, fp, at });
  }
  const seen = family.map((c) => c.fp);
  if (!family.length) return { seen };
  const stamped = family.filter((c) => c.at !== undefined).sort(newerRoot);
  let chosen: RootVersion;
  if (stamped.length) chosen = stamped[0]!;
  else {
    const plain = family.sort((a, b) => b.fp.localeCompare(a.fp));
    let value = plain[0]!.value;
    if (id.startsWith("yearNotes:") && typeof value === "string") {
      let joined = value;
      for (const c of plain.slice(1))
        if (typeof c.value === "string") joined = joinNotes(joined, c.value);
      value = joined;
    }
    // 家里几台（都没时刻）各执一版：加入的这台替全家定下一版，盖上时刻，新版手机都跟它；家里一致就不盖。
    const fp = rootFp(value);
    chosen = plain.length > 1 ? { value, fp, at: now } : { value, fp };
  }
  const mine = rootValue(local, id);
  if (id.startsWith("yearNotes:") && typeof mine === "string" && mine !== "") {
    const value = joinVersions([chosen, { value: mine, fp: rootFp(mine) }]);
    const fp = rootFp(value);
    if (fp !== chosen.fp)
      return { version: { value, fp, at: nextStamp(latestStamp([chosen, { value: mine, fp, at: stampOf(local, id) }]), now) }, seen };
  }
  return { version: chosen, seen };
}
/**
 * joining：这台手机头一回并入这个家（新钥匙加入后第一轮成功合并之前，见 RemoteState.joining）。
 * 家里已经有的根值与人物听家里的：本机加入前在设置里填的名字、格言、选片，时刻再新也不盖掉家里的；
 * 家里没有的（没填过、也没清空过）由本机补上，带着本机的时刻传给全家。同一年的寄语两边都有时接起来，一个字不丢。
 * 家里还没有任何清单（建家的那台）时什么都不用让，本机的值照常发出去。
 */
export type MergeOptions = { joining?: boolean };
export function mergeLibraries(
  local: Library,
  remotes: readonly RemoteSnapshot[],
  base: SyncBase,
  now: string = new Date().toISOString(),
  options: MergeOptions = {},
): MergeResult {
  const joining = options.joining === true;
  // 有没有合并历史（恢复、忘了合并历史、头一回加入时没有）；某一项不在基里只说明它是新的。
  const hasBase = Object.keys(base.merged).length > 0;
  // 清单新的在前：同一实体的几份远端版本按新旧排，素材也先从新清单里找。
  const ordered = [...remotes].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const next = forkLibrary(local);
  const conflicts: Conflict[] = [];
  const known: Record<string, string[]> = {};
  for (const [key, list] of Object.entries(base.known)) known[key] = [...list];
  const remember = (key: string, fp: string | undefined) => {
    if (fp === undefined) return;
    const list = known[key] ?? (known[key] = []);
    const at = list.indexOf(fp);
    if (at >= 0) list.splice(at, 1);
    list.push(fp);
    if (list.length > KNOWN_LIMIT) list.splice(0, list.length - KNOWN_LIMIT);
  };
  let pulled = 0;
  // 墓碑：全家的并集，同一块碑取最晚的时刻。
  const tombstones: Record<string, string> = { ...(local.tombstones ?? {}) };
  for (const r of ordered)
    for (const [key, at] of Object.entries(r.library.tombstones ?? {}))
      if (!tombstones[key] || Date.parse(at) > Date.parse(tombstones[key]!))
        tombstones[key] = at;
  const conflict = (
    kind: SharedKind,
    id: string,
    winner: Shared,
    loser: Shared,
    device: string | null,
    deleted = false,
  ) => {
    if (kind !== "records" && kind !== "letters") return;
    const by = deleted ? undefined : byOf(kind, winner);
    conflicts.push({
      key: `${kind}:${id}`,
      kind,
      entityId: id,
      at: now,
      device,
      winner: {
        updatedAt: winner.updatedAt!,
        ...(by ? { by } : {}),
        ...(deleted ? { deleted: true } : {}),
      },
      loser: loser as unknown as LocalRecord | LocalLetter,
    });
  };
  const remove = (kind: SharedKind, id: string, deletedAt: string) => {
    if (kind === "persons") removePerson(next, id, deletedAt);
    else delete collection(next, kind)[id];
    tombstones[`${kind}:${id}`] = deletedAt;
    pulled++;
  };
  const adopt = (kind: SharedKind, id: string, entity: Shared) => {
    const local = collection(next, kind)[id] as Stored<LocalRecord> | undefined;
    // revision 是这台手机的草稿防撞计数：接别人的版本时在本机原值上加一，基于旧版的草稿保存时会被拦下。
    const adopted: Shared =
      kind === "records"
        ? ({
            ...entity,
            revision: (local?.revision ?? 0) + 1,
          } as Shared)
        : { ...entity };
    // 人物：并进来的一版不比本机这版新（1.1.6 手机改名不动 updatedAt、没有 updatedAt 的旧人物）却换了名字，
    // 就给它盖一个晚于本机这版的时刻，从此进入有版本的世界，丢了的手机上的旧名字压不回来。没有基时说不清，不盖。
    if (
      kind === "persons" &&
      local &&
      base.merged.persons?.[id] !== undefined &&
      !(local.updatedAt === undefined
        ? entity.updatedAt !== undefined
        : timeOf(entity) > timeOf(local)) &&
      contentHashOf(entity) !== contentHashOf(local)
    )
      adopted.updatedAt = nextStamp(local.updatedAt ?? entity.updatedAt, now);
    collection(next, kind)[id] = adopted;
    pulled++;
  };
  for (const kind of SHARED_KINDS) {
    const ids = new Set(Object.keys(local[kind]));
    for (const r of ordered)
      for (const id of Object.keys(r.library[kind])) ids.add(id);
    for (const id of ids) {
      const key = `${kind}:${id}`;
      const L = collection(local, kind)[id];
      const M = base.merged[kind]?.[id];
      const fpL = L ? fingerprintOf(L) : undefined;
      const deletedAt = tombstones[key];
      const knownHere = new Set(base.known[key] ?? []);
      remember(key, M);
      remember(key, fpL);
      const candidates: Version[] = [];
      for (const r of ordered) {
        const R = collection(r.library, kind)[id];
        if (!R) continue;
        const fp = L && sameVersion(R, L) ? fpL! : fingerprintOf(R);
        if (fp === fpL || fp === M || knownHere.has(fp)) continue;
        if (candidates.some((c) => c.fp === fp)) continue;
        candidates.push({
          fp,
          entity: R,
          device: r.deviceName ?? "另一台手机",
        });
      }
      candidates.sort(newest);
      const [C, ...rest] = candidates;
      for (const other of rest) remember(key, other.fp);
      if (!C) {
        // 别人删了它（墓碑比它新）；本机在墓碑之后改过就留下。
        if (L && deadBy(deletedAt, L)) {
          if (fpL !== M)
            conflict(kind, id, { id, updatedAt: deletedAt }, L, null, true);
          remove(kind, id, deletedAt!);
        }
        continue;
      }
      remember(key, C.fp);
      if (deadBy(deletedAt, C.entity)) {
        if (L && deadBy(deletedAt, L)) {
          if (fpL !== M)
            conflict(kind, id, { id, updatedAt: deletedAt }, L, null, true);
          remove(kind, id, deletedAt!);
        }
        continue;
      }
      if (!L) {
        adopt(kind, id, C.entity);
        continue;
      }
      // 头一回加入：家里有这个人（同一个 id）就听家里的。
      if (joining && kind === "persons") {
        adopt(kind, id, C.entity);
        continue;
      }
      const localVersion: Version = { fp: fpL!, entity: L, device: null };
      if (fpL === M) {
        // 本机没动：拿远端的——除非远端这一版比本机还旧（恢复了旧备份、或时钟不准），那就留本机、出卡。
        // 远端接着本机这版改的：照收，时钟慢不算旧。远端这版在本机的世系里（丢了的手机、恢复前的旧清单）：早被本机包含，不出卡。
        const relation = relationOf(C, localVersion);
        if (relation === "descendant") {
          adopt(kind, id, C.entity);
          continue;
        }
        if (relation === "ancestor") continue;
        if (isOlder(C.entity, L)) conflict(kind, id, L, C.entity, C.device);
        else {
          // 已发布的本机版也可能输给并发编辑：对方有世系却不源自本机版时，本机也留底。
          if (hashPart(fpL!) !== hashPart(C.fp) && relation === "concurrent")
            conflict(kind, id, C.entity, L, null);
          adopt(kind, id, C.entity);
        }
        continue;
      }
      // 两边都动了。
      if (hashPart(fpL!) === hashPart(C.fp)) {
        if (!isOlder(C.entity, L)) adopt(kind, id, C.entity);
        continue;
      }
      // 一边的世系里有另一边（恢复了旧备份、重新加入后读到旧手机的清单）：旧的已包含在新的里，直接取新的，不出卡。
      const relation = relationOf(C, localVersion);
      if (relation === "descendant") {
        adopt(kind, id, C.entity);
        continue;
      }
      if (relation === "ancestor") continue;
      const remoteWins = newest(C, localVersion) < 0;
      const winner = remoteWins ? C : localVersion,
        loser = remoteWins ? localVersion : C;
      if (kind === "albums" || kind === "series") {
        const merged =
          kind === "albums"
            ? unionAlbum(
                winner.entity as Stored<LocalAlbum>,
                loser.entity as Stored<LocalAlbum>,
                now,
              )
            : unionSeries(
                winner.entity as Stored<LocalSeries>,
                loser.entity as Stored<LocalSeries>,
                now,
              );
        if (fingerprintOf(merged) !== fpL) adopt(kind, id, merged);
        continue;
      }
      if (remoteWins) adopt(kind, id, C.entity);
      conflict(kind, id, winner.entity, loser.entity, loser.device);
    }
  }
  // 根字段。旧基只记着整份资料的指纹：哪一边的资料与它相同，那一边的各字段就是基。
  const legacyProfile = base.merged.root?.profile;
  const unchangedProfile =
    legacyProfile === undefined
      ? undefined
      : [local, ...ordered.map((r) => r.library)].find(
          (lib) => hashOf(lib.profile) === legacyProfile,
        )?.profile;
  const legacyProfileBase = (id: RootId) =>
    unchangedProfile && id.startsWith("profile:")
      ? rootFp(unchangedProfile[id.slice(8) as ProfileField])
      : undefined;
  // 资料拆成几项合并，拉来几项也只算一处改动。
  let profilePulled = false;
  const countRoot = (id: RootId) => {
    if (id.startsWith("profile:")) {
      if (profilePulled) return;
      profilePulled = true;
    }
    pulled++;
  };
  // 根值的版本：并进来的值带着它的时刻写进 next.rootStamps；清空、改回都是有时刻的改动。
  const stamps: Record<string, string> = { ...(local.rootStamps ?? {}) };
  const rootKeys = new Set(rootIds(local));
  for (const lib of [local, ...ordered.map((r) => r.library)]) {
    if (lib !== local) for (const id of rootIds(lib)) rootKeys.add(id);
    for (const id of Object.keys(lib.rootStamps ?? {}))
      if (ROOT_STAMP_KEY.test(id)) rootKeys.add(id);
  }
  for (const id of rootKeys) {
    const key = `root:${id}`;
    const localValue = rootValue(local, id);
    const fpL = rootFp(localValue);
    const M = base.merged.root?.[id] ?? legacyProfileBase(id);
    const knownHere = new Set(base.known[key] ?? []);
    remember(key, M);
    // 头一回加入：本机加入前填的值不是家里的历史，不记作「见过」——家里以后改成同一个值也要跟上。
    if (!joining) remember(key, fpL);
    if (!id.startsWith("yearPicks:")) {
      const result = joining
        ? joinRoot(id, local, ordered, now)
        : mergeVersionedRoot(id, local, ordered, M, knownHere, now, hasBase);
      for (const fp of result.seen) remember(key, fp);
      if (!result.version) continue;
      const { value, at } = result.version;
      if (rootFp(value) !== fpL) {
        setRoot(next, id, value);
        countRoot(id);
      }
      if (at === undefined) delete stamps[id];
      else stamps[id] = at;
      continue;
    }
    // 年度册目录自带 updatedAt，照旧：按更新时间，再按内容哈希。头一回加入时家里有这一年的目录就只在家里的里面挑。
    const candidates: { fp: string; value: unknown }[] = [];
    for (const r of ordered) {
      const value = rootValue(r.library, id);
      const fp = rootFp(value);
      if (!joining && (fp === fpL || fp === M || knownHere.has(fp))) continue;
      // 还没有基（头一回合并）时，空着的一项就是没填过，不算改动。
      if (M === undefined && isBlank(value)) continue;
      if (candidates.some((c) => c.fp === fp)) continue;
      candidates.push({ fp, value });
    }
    if (!candidates.length) continue;
    for (const candidate of candidates) remember(key, candidate.fp);
    // 所有改过的版本一起比较：只拿第一台会把其他手机的改动记成「见过」却丢掉。
    // 本机没动（或初次加入时没填）不参加竞争，单边删除仍能传过来。
    if (!joining && fpL !== M && !(M === undefined && isBlank(localValue)))
      candidates.push({ fp: fpL, value: localValue });
    candidates.sort((a, b) => {
      if (a.value && b.value) {
        const at = Date.parse((a.value as { updatedAt: string }).updatedAt);
        const bt = Date.parse((b.value as { updatedAt: string }).updatedAt);
        if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return bt - at;
      }
      return b.fp.localeCompare(a.fp);
    });
    const value = candidates[0]!.value;
    if (rootFp(value) !== fpL) {
      setRoot(next, id, value);
      countRoot(id);
    }
  }
  if (Object.keys(stamps).length) next.rootStamps = stamps;
  else delete next.rootStamps;
  // 装订时刻：谁先装订算谁的（按年取早）。
  const bound: Record<string, string> = { ...(local.yearBooksBoundAt ?? {}) };
  for (const r of ordered)
    for (const [year, at] of Object.entries(r.library.yearBooksBoundAt ?? {}))
      if (!bound[year] || Date.parse(at) < Date.parse(bound[year]!))
        bound[year] = at;
  if (Object.keys(bound).length) next.yearBooksBoundAt = bound;
  if (Object.keys(tombstones).length) next.tombstones = tombstones;
  // 素材：按 id 取并集，本机已有的永不被覆盖；只带回合并后共享实体引用到的那些，
  // 外加留底版本引用的——本机那版赢了时，对方那版的照片只有现在能拿到，「用这一版」才不丢图。
  mergeHistory(next, [local, ...ordered.map((r) => r.library)]);
  const wantedMedia: Stored<LocalMedia>[] = [];
  const loserMedia = conflicts.flatMap(
    (c) => (c.loser as LocalRecord | LocalLetter).mediaIds,
  );
  for (const mediaId of new Set([...referencedShared(next), ...loserMedia])) {
    if (next.media[mediaId]) continue;
    for (const r of ordered) {
      const m = r.library.media[mediaId];
      if (!m) continue;
      const { thumb: _thumb, ...rest } = m;
      next.media[mediaId] = rest;
      wantedMedia.push(rest);
      break;
    }
  }
  unifyPersons(next, now);
  repairReferences(next);
  // 新的基：合并结果的指纹，加上这一路认得的全部版本。
  const merged: SyncBase["merged"] = {};
  for (const kind of SHARED_KINDS) {
    const fps: Record<string, string> = {};
    for (const [id, e] of Object.entries(collection(next, kind)))
      fps[id] = fingerprintOf(e);
    merged[kind] = fps;
  }
  const root: Record<string, string> = {};
  for (const id of rootIds(next)) root[id] = rootFp(rootValue(next, id));
  merged.root = root;
  for (const [kind, ids] of Object.entries(merged))
    for (const [id, fp] of Object.entries(ids))
      if (known[`${kind}:${id}`]) remember(`${kind}:${id}`, fp);
  return {
    next,
    conflicts,
    wantedMedia,
    base: { version: 1, merged, known },
    pulled,
  };
}
/** 相册两边都改：名字、寄语、封面随赢家，条目并集（赢家在前）；有新增就盖上合并时刻，免得两台再各执一版。 */
function unionAlbum(
  winner: Stored<LocalAlbum>,
  loser: Stored<LocalAlbum>,
  now: string,
): Stored<LocalAlbum> {
  const items = unionItems(winner.items, loser.items, (i) => i.recordId);
  return items.length === winner.items.length
    ? winner
    : { ...winner, items, updatedAt: now };
}
/** 系列两边都改：同一个月各选了一张时听赢家的，别的月份并起来。 */
function unionSeries(
  winner: Stored<LocalSeries>,
  loser: Stored<LocalSeries>,
  now: string,
): Stored<LocalSeries> {
  const items = unionItems(winner.items, loser.items, (i) => i.month);
  return items.length === winner.items.length
    ? winner
    : { ...winner, items, updatedAt: now };
}
