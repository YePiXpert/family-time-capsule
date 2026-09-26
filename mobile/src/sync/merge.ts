import { contentHashOf, hashOf, lineage } from "../local/hash";
import {
  TOMBSTONE_KINDS,
  deletePerson,
  editEntity,
  forkLibrary,
  mergePersons,
  type Library,
  type LocalAlbum,
  type LocalLetter,
  type LocalMedia,
  type LocalPerson,
  type LocalRecord,
  type LocalSeries,
  type Stored,
  type TombstoneKind,
} from "../local/model";
export { canonical, contentHashOf, hashOf } from "../local/hash";
/**
 * 家人一起写的合并：纯函数，不碰磁盘不碰网络。输入本机库、别人的清单（整库快照）与上次同步之基，
 * 输出合并后的库、新记的冲突、要去下载的素材与新的基。任何一步都不改传入的对象。
 *
 * 逐实体（records／albums／series／letters／persons）三方合并，基是三样东西：
 * - merged：上次同步结束时本机每个实体的指纹。本机指纹 = 它 → 本机这一段没动过。
 * - known：本机已经处理过的其他版本（曾持有、曾判输、曾判过时）。别人的清单是整库快照，
 *   输掉的旧版会一直躺在里面，认得它们才不会把删掉、改掉的东西送回来，也不会反复出同一张冲突卡。
 * - published：各台上次发布的根字段与人物，认出没有时间戳的值被改回见过的一枚（见 SyncBase）。
 * 规则：远端版本与本机相同、与基相同或已认得 → 不看；世系先说话：远端接着本机改的 → 取远端（哪怕时钟慢），
 * 远端早在本机世系里 → 不动。其余：本机没动 → 取远端（远端比本机还旧的除外：
 * 留本机、出冲突卡；远端有世系但不源自本机版时，本机输掉的一版也留底）；两边都动 → 按 updatedAt 新者胜、同秒比内容哈希，输的一版留底；内容相同不算冲突。
 * 空基（刚恢复了备份、带着自己的资料加入）：没有时间戳的资料、封面、人物，家里有的听家里最新那份清单，本机只补家里没有的；
 * 年度寄语照旧接上每一段，选片目录照旧新者胜。
 * 墓碑：删除时刻晚于实体 updatedAt → 删（本机改过又被删也留底）；实体在墓碑之后改过 → 改者胜。
 * 相册／系列两边都动：名字随赢家，条目取并集（赢家在前）；人物同名自动并成一个（id 小的留下）。
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
 * 版本号一直是 1：published 是后加的可选项，新旧应用读对方写的 base.json 都不出错。
 */
export type SyncBase = {
  version: 1;
  merged: Record<string, Record<string, string>>;
  known: Record<string, string[]>;
  /**
   * 每台手机上次并入的清单里各根字段与人物的指纹尾（deviceId → "root:…"／"persons:…" → publishedTag；根字段空着不记）。
   * 这些值没有 updatedAt，改回见过的值（桉桉→安安→桉桉、奶奶→外婆→奶奶）指纹也回到见过的一枚，光靠 known 会被当成旧版挡掉。
   * 那台手机上次发布的与本机的基相同、这次换了：是它新的改动，哪怕换成了见过的值。清单没变的旧快照不算。
   * 旧版的 base.json 没有这一项：头一轮照旧只认 known，之后就有了；旧版应用读新文件时忽略它。
   */
  published?: Record<string, Record<string, string>>;
};
/** 每个实体最多记这么多枚见过的指纹；改动本来就少，超过就丢最旧的。 */
export const KNOWN_LIMIT = 32;
/** 最多记这么多台手机的上次发布（新读到的在前）；一个家不会有这么多台。 */
export const PUBLISHED_DEVICES = 32;
/** 发布记录只存指纹尾 16 位：只用来比「变没变」，省地方。 */
export const publishedTag = (fp: string) => fp.slice(-16);
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
/** 新者在前：先比 updatedAt，再比内容哈希——两台手机对同两版算出同一个赢家。 */
function newest(a: Version, b: Version): number {
  const ta = timeOf(a.entity),
    tb = timeOf(b.entity);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
  return hashPart(b.fp).localeCompare(hashPart(a.fp));
}
const isOlder = (a: Shared, b: Shared) => {
  const ta = timeOf(a),
    tb = timeOf(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta < tb;
};
/** 墓碑压得住这一版吗：删除时刻晚于它的 updatedAt；没有 updatedAt 的（人物）一律压得住。 */
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
/** 资料按字段各一块：一台改名字、另一台改生日，两边都留下。 */
const PROFILE_FIELDS = ["name", "fullName", "motto", "birthday", "avatarId"] as const;
type ProfileField = (typeof PROFILE_FIELDS)[number];
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
    ...Object.keys(lib.yearPicks ?? {}).map((y) => `yearPicks:${y}`),
  ];
}
function rootValue(lib: Library, id: RootId): unknown {
  if (id.startsWith("profile:"))
    return lib.profile[id.slice(8) as ProfileField];
  const [field, year] = id.split(":") as ["yearNotes" | "yearCovers" | "yearPicks", string];
  return lib[field]?.[year];
}
function setRoot(lib: Library, id: RootId, value: unknown): void {
  if (id.startsWith("profile:")) {
    const profile: Record<string, unknown> = { ...lib.profile };
    if (value === undefined) delete profile[id.slice(8)];
    else profile[id.slice(8)] = value;
    lib.profile = profile as Library["profile"];
    return;
  }
  const [field, year] = id.split(":") as ["yearNotes" | "yearCovers" | "yearPicks", string];
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
    ...Object.values(s.letters).flatMap((l) => l.mediaIds),
  ]);
}
export function mergeLibraries(
  local: Library,
  remotes: readonly RemoteSnapshot[],
  base: SyncBase,
  now: string = new Date().toISOString(),
): MergeResult {
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
  // 这一轮读到的各台清单里根字段与人物的指纹尾；同一台只认最新的一份（ordered 新的在前）。
  const latest = new Map<string, RemoteSnapshot>();
  for (const r of ordered) if (!latest.has(r.deviceId)) latest.set(r.deviceId, r);
  const published: Record<string, Record<string, string>> = {};
  const publish = (r: RemoteSnapshot, key: string, fp: string) => {
    if (latest.get(r.deviceId) === r) (published[r.deviceId] ??= {})[key] = publishedTag(fp);
  };
  /** 这台手机上次发布的正是本机的基，这次换成了 fp：它刚改过（哪怕改回了见过的值）。 */
  const movedOn = (r: RemoteSnapshot, key: string, fp: string, M: string | undefined) => {
    const before = base.published?.[r.deviceId];
    if (!before || M === undefined || latest.get(r.deviceId) !== r) return false;
    const previous = before[key] ?? "-";
    return previous === publishedTag(M) && previous !== publishedTag(fp);
  };
  // 空基：刚恢复了备份（恢复先清掉合并记录）或带着自己的资料刚加入。没有时间戳的根字段与人物分不出谁新，
  // 家里已有的就听家里的（最新的那份清单），本机的只补家里没有的——否则旧备份里的名字会被当成新改动传遍全家。
  const fresh = !Object.keys(base.merged).length && !Object.keys(base.known).length;
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
        // 人物没有 updatedAt：改名改回去（奶奶→外婆→奶奶）只能靠那台手机的发布记录认出来。
        if (kind === "persons") publish(r, key, fp);
        if (fp === fpL || fp === M) continue;
        if (knownHere.has(fp) && !(kind === "persons" && movedOn(r, key, fp, M))) continue;
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
      if (fresh && kind === "persons") {
        // 空基：人物听家里最新的那份清单；它与本机相同就不动。
        const family = ordered.map((r) => collection(r.library, kind)[id]).find((e) => !!e)!;
        if (!sameVersion(family, L)) adopt(kind, id, family);
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
  const rootKeys = new Set(rootIds(local));
  for (const r of ordered)
    for (const id of rootIds(r.library)) rootKeys.add(id);
  for (const id of rootKeys) {
    const key = `root:${id}`;
    const localValue = rootValue(local, id);
    const fpL = rootFp(localValue);
    const M = base.merged.root?.[id] ?? legacyProfileBase(id);
    const knownHere = new Set(base.known[key] ?? []);
    remember(key, M);
    remember(key, fpL);
    const candidates: { fp: string; value: unknown }[] = [];
    // 选片目录自带 updatedAt，真改动的指纹必定是新的，不需要发布记录。
    const timed = id.startsWith("yearPicks:");
    for (const r of ordered) {
      const value = rootValue(r.library, id);
      const fp = rootFp(value);
      if (!timed && fp !== "-") publish(r, key, fp);
      if (fp === fpL || fp === M) continue;
      // 见过的值：那台手机刚从本机的基改过来（改回去了）才算新改动，一直躺在清单里的旧值不算。
      if (knownHere.has(fp) && (timed || !movedOn(r, key, fp, M))) continue;
      // 还没有基（头一回合并）时，空着的一项就是没填过，不算改动。
      if (M === undefined && isBlank(value)) continue;
      if (candidates.some((c) => c.fp === fp)) continue;
      candidates.push({ fp, value });
    }
    if (!candidates.length) continue;
    for (const candidate of candidates) remember(key, candidate.fp);
    // 所有改过的版本一起比较：只拿第一台会把其他手机的改动记成「见过」却丢掉。
    // 本机没动（或初次加入时没填）不参加竞争，单边删除仍能传过来。
    if (fpL !== M && !(M === undefined && isBlank(localValue)))
      candidates.push({ fp: fpL, value: localValue });
    candidates.sort((a, b) => {
      if (id.startsWith("yearPicks:") && a.value && b.value) {
        const at = Date.parse((a.value as { updatedAt: string }).updatedAt);
        const bt = Date.parse((b.value as { updatedAt: string }).updatedAt);
        if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return bt - at;
      }
      return b.fp.localeCompare(a.fp);
    });
    // 空基：家里最新那份清单里有值的，资料、封面就取它。选片目录自带 updatedAt，照旧新者胜；
    // 年度寄语照旧按哈希顺序接上每一段（一个字不丢，旧备份里被包含的那段不重复）——换了顺序，别的手机会把同样几段再接一遍。
    if (fresh && !timed && !id.startsWith("yearNotes:")) {
      const familyFp = ordered
        .map((r) => rootValue(r.library, id))
        .filter((v) => !isBlank(v))
        .map(rootFp)[0];
      const at = candidates.findIndex((c) => c.fp === familyFp);
      if (at > 0) candidates.unshift(...candidates.splice(at, 1));
    }
    // 默认按内容哈希；目录先比更新时间；年度寄语按同一顺序接上每台手机的文字。
    let value = candidates[0]!.value;
    if (id.startsWith("yearNotes:") && typeof value === "string") {
      let joined = value;
      for (const candidate of candidates.slice(1))
        if (typeof candidate.value === "string") joined = joinNotes(joined, candidate.value);
      value = joined;
    }
    if (rootFp(value) !== fpL) {
      setRoot(next, id, value);
      countRoot(id);
    }
  }
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
  // 这一轮读到的手机换上新记录，没读到的（清单没变）照旧；新读到的在前，按台数封顶。
  const nextPublished: Record<string, Record<string, string>> = {};
  for (const device of latest.keys()) nextPublished[device] = published[device] ?? {};
  for (const [device, tags] of Object.entries(base.published ?? {}))
    if (!latest.has(device)) nextPublished[device] = tags;
  const publishedDevices = Object.keys(nextPublished).slice(0, PUBLISHED_DEVICES);
  return {
    next,
    conflicts,
    wantedMedia,
    base: {
      version: 1,
      merged,
      known,
      ...(publishedDevices.length
        ? { published: Object.fromEntries(publishedDevices.map((d) => [d, nextPublished[d]!])) }
        : {}),
    },
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
