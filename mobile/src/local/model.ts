import { CHILD_FALLBACK } from "./brand";
import { lineage } from "./hash";
import type { AIJob, AIProposal } from "../ai/types";
import { validateStoredAI } from "../ai/state";
export type DailyQuestionCache = {
  requestedDay: string;
  day?: string;
  question?: string;
  asked: { day: string; question: string }[];
};
/** Device-owned data. No account identity or transport state belongs here. */
export type PhotoMetadata = {
  /** Camera-local wall time, without timezone conversion, to preserve the photographed day. */
  capturedAt?: string;
  latitude?: number;
  longitude?: number;
};
export type MediaKind = "image" | "video" | "audio" | "document";
export type LocalMedia = {
  id: string;
  file: string;
  name: string;
  kind: MediaKind;
  bytes: number;
  sha256: string;
  photoMetadata?: PhotoMetadata;
  /** 像素尺寸（保存时可由缩略图渲染得出），仅用于版面比例；旧素材缺省。 */
  width?: number;
  height?: number;
  /** mediaDirectory 内的持久 512px JPEG 缩略图文件名；旧素材缺省。 */
  thumb?: string;
};
/** 旧主题取值，仅用于读取旧记录与备份。 */
export type StoryTopic = "birth" | "pregnancy" | "name" | "met";
export type RecordContent = {
  title: string;
  text: string;
  date: string;
  location: string;
  first: boolean;
  mediaIds: string[];
  coverId: string | null;
  /** 出现的人物；旧记录无此字段。 */
  personIds?: string[];
  /** 她说的话：这一条记的是她的原话，收进语录册；旧记录无此字段。 */
  quote?: boolean;
  /** 旧字段：1.0.3 起不再写入、不再显示；旧记录可能带着它。 */
  story?: StoryTopic;
  /** 落款：谁写的，用关系称呼（爸爸／妈妈／外婆…），1–20 字、首尾无空白；旧记录无此字段。 */
  by?: string;
};
export const BY_LIMIT = 20;
/** 落款的候选称呼：用过的排前面，这些兜底。 */
export const BY_PRESETS = ["爸爸", "妈妈", "外婆", "外公", "奶奶", "爷爷"] as const;
export type LocalRecord = RecordContent & {
  id: string;
  revision: number;
  updatedAt: string;
  /** 最近八版源内容的哈希前缀，最新的在前；旧版本缺省。 */
  ancestors?: string[];
};
export type RecordDraft = {
  id: string;
  recordId: string | null;
  baseRevision: number;
  content: RecordContent;
  updatedAt: string;
  recordingFile?: string;
  autoDate?: boolean;
  autoLocation?: boolean;
  aiJob?: AIJob;
  aiProposal?: AIProposal;
};
export type LocalAlbum = {
  id: string;
  name: string;
  items: { id: string; recordId: string }[];
  coverId: string | null;
  updatedAt: string;
  /** 扉页寄语，最多 2000 字；旧相册无此字段。 */
  note?: string;
};
export type SelectionSession = {
  id: string;
  albumId: string | null;
  selected: string[];
  month: string;
  offset: number;
  name: string;
  coverId: string | null;
};
export type SeriesItem = {
  recordId: string;
  mediaId: string;
  /** 形如 "2026-09"，每系列内唯一；取自素材拍摄时间，缺省用记录日期。 */
  month: string;
};
/** 旧数据种类：1.0.3 起不再新建、无页面；保留读写、合并、备份与归档以兼容旧库。 */
export type LocalSeries = {
  id: string;
  name: string;
  items: SeriesItem[];
  updatedAt: string;
};
export type LocalPerson = {
  id: string;
  name: string;
  /** 最近一次改名的时刻（LocalStore.change 盖上）；1.1.6 及更早建的人物没有。 */
  updatedAt?: string;
};
/** 时间胶囊信：现在写，封存到 openAt 那天才拆。封存后不再可改。 */
export type LocalLetter = {
  id: string;
  title: string;
  text: string;
  /** 落款，如「妈妈」。 */
  from: string;
  /** 拆封日，本地日历日 "YYYY-MM-DD"。 */
  openAt: string;
  writtenAt: string;
  sealed: boolean;
  /** 拆封（含提前拆封）的时刻；缺省表示还没拆。 */
  openedAt?: string;
  /** 随信附上的录音或照片。 */
  mediaIds: string[];
  coverId: string | null;
  updatedAt: string;
  /** 最近八版源内容的哈希前缀，最新的在前；旧版本缺省。 */
  ancestors?: string[];
};
export const LETTER_TITLE_LIMIT = 100;
export const LETTER_TEXT_LIMIT = 5000;
export const LETTER_FROM_LIMIT = 50;
export type LocalProfile = {
  name: string;
  /** 本名；没填时不存空字符串。 */
  fullName?: string;
  /** 名字的来历，一句话。 */
  motto?: string;
  birthday: string;
  avatarId: string | null;
};
/** 名字印章取首个 Unicode 码点，保留扩展汉字；空白名字统一用品牌默认称呼。 */
export function sealInitial(name: string): string {
  return Array.from(name.trim() || CHILD_FALLBACK)[0]!;
}
/** 信封圆章：落款首个码点（emoji、扩展汉字不被劈成半个），没有落款用「信」。 */
export function letterSeal(from: string): string {
  return Array.from(from.trim())[0] ?? "信";
}
/** 应用与纸书扉页共用；开放归档阅读器保持相同拼法。 */
export function fullNameLine(fullName: string, name: string): string {
  return name.trim() ? `${fullName} · 小名${name.trim()}` : "";
}
/** 库里存着的实体是只读的：一次 change 里只能整个替换（见 editEntity），
 * 不能原地改——共享的是同一个对象，原地改会当场污染界面上的当前状态。 */
export type Stored<T> = {
  readonly [K in keyof T]: T[K] extends (infer U)[] ? readonly U[] : T[K];
};
/** 年度册目录：AI 建议、家人拍板；按年存；归档不带。 */
export type YearPicks = {
  /** 家人确认的书名；缺省用「{名}的 {年} 年」。 */
  title?: string;
  months: Record<string, {
    recordIds: string[];
    quote?: { recordId: string; text: string };
  }>;
  notes?: string;
  updatedAt: string;
};
export type Library = {
  version: 1;
  revision: number;
  welcome: boolean;
  profile: LocalProfile;
  settings: {
    theme: "auto" | "light" | "dark";
    largeText: boolean;
    /** 每天的小问题，仅留在这台手机。 */
    dailyQuestion?: DailyQuestionCache;
    lockEnabled?: boolean;
    /** 旧版本留下的转写同意；现在不再询问，只为读得进旧库而保留。 */
    transcribeConsent?: boolean;
    /** 这台手机默认的落款（新草稿带上它）；本机设置，不随家人同步。 */
    by?: string;
  };
  records: Record<string, Stored<LocalRecord>>;
  drafts: Record<string, Stored<RecordDraft>>;
  media: Record<string, Stored<LocalMedia>>;
  albums: Record<string, Stored<LocalAlbum>>;
  selections: Record<string, Stored<SelectionSession>>;
  /** 同款时光对比系列；旧库无此字段。 */
  series: Record<string, Stored<LocalSeries>>;
  /** 记录里出现的人物；旧库无此字段。 */
  persons: Record<string, Stored<LocalPerson>>;
  /** 时间胶囊信；旧库无此字段。 */
  letters: Record<string, Stored<LocalLetter>>;
  /** 「爸爸妈妈的话」annual notes, keyed by four-digit year like "2026". */
  yearNotes: Record<string, string>;
  /** 年度纪念册手选的封面素材，按四位年份存；没选就按当年最新一张照片自动定。 */
  yearCovers: Record<string, string>;
  yearPicks?: Record<string, YearPicks>;
  /** 哪些年的纪念册 PDF 装订过（ISO 时刻，按四位年份存）；书架据此决定要不要提「去年的册子可以装订了」。旧库无此字段。 */
  yearBooksBoundAt?: Record<string, string>;
  /** 书架提醒卡各自最近一次被关掉的 ISO 时刻，按提醒种类存（conflict／by／milestone／book／backup／rhythm）；沉默期见 nudge.ts。旧库无此字段。 */
  nudgeClosedAt?: Record<string, string>;
  receivedShares: string[];
  /** ISO timestamp of the last successful export; undefined until the first one. */
  lastExportAt?: string;
  /**
   * 墓碑：删掉的记录／相册／系列／信／人物，按 "kind:id" 记删除时刻。家人一起写时靠它区分
   * 「对方删了」与「对方还没收到」，否则合并会把删掉的东西送回来。随备份走、不进开放归档、永不清理。旧库无此字段。
   */
  tombstones?: Record<string, string>;
  /**
   * 共享根值的版本：资料各字段（"profile:name"…）、年度寄语与封面（"yearNotes:2026"、"yearCovers:2026"）
   * 各自最近一次改动的 ISO 时刻。LocalStore.change 在值变了时盖上，合并与恢复自己写；清空了的值也留着时刻
   * （那是一次改动）。改回见过的值也有新时刻，家人才跟得上。选片（yearPicks）自带 updatedAt，不在这里。旧库无此字段。
   */
  rootStamps?: Record<string, string>;
};
/** 资料按字段各一块：一台改名字、另一台改生日，两边都留下。 */
export const PROFILE_FIELDS = ["name", "fullName", "motto", "birthday", "avatarId"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
/** 带版本的根值 id：资料字段、某年的寄语、某年的封面。 */
export const ROOT_STAMP_KEY = /^(profile:(name|fullName|motto|birthday|avatarId)|(yearNotes|yearCovers):\d{4})$/;
/** 库里现有的带版本根值 id（不含只剩时刻、值已清掉的那些）。 */
export function versionedRootIds(lib: Library): string[] {
  return [
    ...PROFILE_FIELDS.map((f) => `profile:${f}`),
    ...Object.keys(lib.yearNotes).map((y) => `yearNotes:${y}`),
    ...Object.keys(lib.yearCovers).map((y) => `yearCovers:${y}`),
  ];
}
/** 一个共享根值（资料字段、某年寄语／封面／选片）；没有就是 undefined。 */
export function rootValue(lib: Library, id: string): unknown {
  if (id.startsWith("profile:"))
    return lib.profile[id.slice(8) as ProfileField];
  const [field, year] = id.split(":") as ["yearNotes" | "yearCovers" | "yearPicks", string];
  return lib[field]?.[year];
}
/** 新的时刻：现在，但至少比上一版晚一毫秒——上一版可能来自时钟快的手机，改动得排在它后面。 */
export function nextStamp(previous: string | undefined, now: string): string {
  const after = previous === undefined ? NaN : Date.parse(previous) + 1;
  return after > Date.parse(now) ? new Date(after).toISOString() : now;
}
/**
 * 给这次 change 改到的共享根值与人物盖上新时刻（LocalStore.change 在校验之前调用）。
 * 值没变的不动；这次改动自己写了时刻的（合并、恢复）也不动。
 */
export function stampChanges(prev: Library, next: Library, delta: LibraryDelta, now: string): void {
  if (prev.profile !== next.profile || prev.yearNotes !== next.yearNotes || prev.yearCovers !== next.yearCovers) {
    const before = prev.rootStamps ?? {},
      after = next.rootStamps ?? {};
    let stamps: Record<string, string> | undefined;
    for (const id of new Set([...versionedRootIds(prev), ...versionedRootIds(next)])) {
      if (rootValue(prev, id) === rootValue(next, id) || before[id] !== after[id]) continue;
      (stamps ??= { ...after })[id] = nextStamp(before[id], now);
    }
    if (stamps) next.rootStamps = stamps;
  }
  for (const { kind, id } of delta.changed) {
    if (kind !== "persons") continue;
    const p = next.persons[id]!,
      old = prev.persons[id];
    if (old ? p.updatedAt !== old.updatedAt || p.name === old.name : p.updatedAt !== undefined) continue;
    next.persons[id] = { ...p, updatedAt: nextStamp(old?.updatedAt, now) };
  }
}
export const TOMBSTONE_KINDS = [
  "records",
  "albums",
  "series",
  "letters",
  "persons",
] as const;
export type TombstoneKind = (typeof TOMBSTONE_KINDS)[number];
export const TOMBSTONE_KEY = /^(records|albums|series|letters|persons):[a-zA-Z0-9_-]{1,128}$/;
/**
 * 记一块墓碑；同一实体反复删只留最新的时刻。删之前调用：时刻至少比被删那一版的 updatedAt 晚一毫秒——
 * 那一版可能来自时钟快的手机，墓碑早于它，合并就压不住，删掉的东西会在别的手机上留着。
 */
export function tombstone(
  s: Library,
  kind: TombstoneKind,
  id: string,
  now: string,
): void {
  const entity = (s[kind] as Record<string, { updatedAt?: string }>)[id];
  const after = entity?.updatedAt === undefined ? NaN : Date.parse(entity.updatedAt) + 1;
  const at = after > Date.parse(now) ? new Date(after).toISOString() : now;
  s.tombstones = { ...s.tombstones, [`${kind}:${id}`]: at };
}
export const emptyLibrary = (): Library => ({
  version: 1,
  revision: 0,
  welcome: false,
  profile: { name: "", birthday: "", avatarId: null },
  settings: { theme: "auto", largeText: false },
  records: {},
  drafts: {},
  media: {},
  albums: {},
  selections: {},
  series: {},
  persons: {},
  letters: {},
  yearNotes: {},
  yearCovers: {},
  receivedShares: [],
});
/** Fills fields added after the first release so older stores and backups still open. */
export function normalizeLibrary(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const s = value as Partial<Library>;
  if (s.yearNotes === undefined) s.yearNotes = {};
  if (s.yearCovers === undefined) s.yearCovers = {};
  if (s.series === undefined) s.series = {};
  if (s.persons === undefined) s.persons = {};
  if (s.letters === undefined) s.letters = {};
  for (const raw of Object.values(s.drafts ?? {})) {
    if (!raw || typeof raw !== "object") continue;
    const draft = raw as unknown as Record<string, unknown>;
    const content = draft.content as RecordContent | undefined;
    // 旧分组的首件事是用草稿自己的标题正文做种子的。按顺序收回每件事的文字：
    // 事件标题作为小节首行（与草稿标题相同的不重复——标题栏还在），正文原样；
    // 草稿自己的正文只在没有任何事件以它开头时才补在最后。一个字不丢，标题栏不动。
    // 附件只认原 content：旧事件可能引用不存在的素材，不能合并它们的 mediaIds。
    if (content && Array.isArray(draft.photoEvents) && draft.photoEvents.length) {
      const events = draft.photoEvents as (Partial<RecordContent> | undefined)[];
      const nonempty = (value: unknown): value is string => typeof value === "string" && !!value.trim();
      const ownTitle = nonempty(content.title) ? content.title.trim() : "";
      const parts = events
        .map((event) => {
          const title = event?.title, text = event?.text;
          return [nonempty(title) && title.trim() !== ownTitle ? title : undefined, text]
            .filter(nonempty)
            .join("\n");
        })
        .filter(Boolean);
      const own = content.text;
      if (
        nonempty(own) &&
        !events.some((event) => {
          const text = event?.text;
          return nonempty(text) && text.trim().startsWith(own.trim());
        })
      )
        parts.push(own);
      content.text = parts.join("\n\n");
    }
    delete draft.photoEvents;
    delete draft.groupPhotosByDay;
    delete draft.manualLocation;
    for (const key of ["aiJob", "aiProposal"] as const) {
      const ai = draft[key] as { kind?: unknown; writingMode?: unknown } | undefined;
      if (ai && (ai.kind === "group" || !["polish", "ask", "question", "recap", "editor"].includes(String(ai.writingMode))))
        delete draft[key];
    }
  }
  // 指向已删除人物的标记会让 validateLibrary 拒绝整库。打开与解码备份时先剥掉，
  // 让校验只在「本次改动写坏了」时报错，而不是把人锁在自己的资料外面。
  const persons = s.persons ?? {};
  // 这里拿到的还是刚解析出来的裸对象，尚未进库也尚未冻结，可以原地改。
  for (const content of [
    ...Object.values(s.records ?? {}),
    ...Object.values(s.drafts ?? {}).map((d) => d?.content),
  ] as (Mutable<RecordContent> | undefined)[]) {
    const tags = content?.personIds;
    if (!Array.isArray(tags)) continue;
    const kept = tags.filter((p) => !!persons[p]);
    if (kept.length === tags.length) continue;
    if (kept.length) content!.personIds = kept;
    else delete content!.personIds;
  }
}
/** 新草稿的正文；这台手机设了默认落款就带上。 */
export const emptyContent = (by?: string): RecordContent => ({
  title: "",
  text: "",
  date: new Date().toISOString(),
  location: "",
  first: false,
  mediaIds: [],
  coverId: null,
  ...(by ? { by } : {}),
});
export const clone = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
/** Stored 的逆运算：editEntity 交出去的副本可以随便改。 */
export type Mutable<T> = {
  -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K];
};
export const ENTITY_KINDS = [
  "records",
  "drafts",
  "media",
  "albums",
  "selections",
  "series",
  "persons",
  "letters",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];
/**
 * 一次 change 的工作副本：根与各集合各复制一层，实体本身按引用与当前状态共享。
 * 因此实体只能整个替换，不能原地改——见 editEntity。
 */
export function forkLibrary(s: Library): Library {
  return {
    ...s,
    profile: { ...s.profile },
    settings: { ...s.settings },
    yearNotes: { ...s.yearNotes },
    yearCovers: { ...s.yearCovers },
    ...(s.yearPicks ? { yearPicks: { ...s.yearPicks } } : {}),
    ...(s.tombstones ? { tombstones: { ...s.tombstones } } : {}),
    ...(s.rootStamps ? { rootStamps: { ...s.rootStamps } } : {}),
    receivedShares: [...s.receivedShares],
    records: { ...s.records },
    drafts: { ...s.drafts },
    media: { ...s.media },
    albums: { ...s.albums },
    selections: { ...s.selections },
    series: { ...s.series },
    persons: { ...s.persons },
    letters: { ...s.letters },
  };
}
/** 改一个实体：拿到的是可以随便改的深拷贝，改完自动放回集合里。实体不存在时什么也不做。 */
export function editEntity<K extends EntityKind>(
  s: Library,
  kind: K,
  id: string,
  apply: (draft: Mutable<Library[K][string]>) => void,
): void {
  const collection = s[kind] as Record<string, unknown>;
  const current = collection[id];
  if (!current) return;
  const draft = clone(current) as Mutable<Library[K][string]>;
  apply(draft);
  collection[id] = draft;
}
/** 一次 change 动过哪些实体：落盘只需要重写这些，不必整库重来。 */
export type LibraryDelta = {
  changed: { kind: EntityKind; id: string }[];
  removed: { kind: EntityKind; id: string }[];
};
/** 按引用比对算出脏实体——实体只会被整个替换，所以引用变了就是改了。 */
export function diffLibrary(prev: Library, next: Library): LibraryDelta {
  const changed: LibraryDelta["changed"] = [];
  const removed: LibraryDelta["removed"] = [];
  for (const kind of ENTITY_KINDS) {
    const before = prev[kind] as Record<string, unknown>;
    const after = next[kind] as Record<string, unknown>;
    for (const id of Object.keys(after))
      if (before[id] !== after[id]) changed.push({ kind, id });
    for (const id of Object.keys(before))
      if (!(id in after)) removed.push({ kind, id });
  }
  return { changed, removed };
}
/** 库里除七个集合之外的部分：版本、profile、settings、yearNotes 这些，很小。 */
export function rootOf(s: Library): Partial<Library> {
  const root: Partial<Library> = { ...s };
  for (const kind of ENTITY_KINDS) delete root[kind];
  return root;
}
/** 冻结实体及其数组与嵌套对象：谁原地改共享对象，就在那一行当场抛错。 */
export function freezeEntity<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  Object.freeze(value);
  for (const inner of Object.values(value)) freezeEntity(inner);
  return value;
}
/** 开库后冻结全部实体；此后每次 change 只需要冻结新替换进来的那几个。 */
export function freezeLibrary(s: Library): void {
  for (const kind of ENTITY_KINDS) {
    for (const entity of Object.values(s[kind])) freezeEntity(entity);
    Object.freeze(s[kind]);
  }
}
/** 只冻结这次动过的实体与集合：其余的在开库或上一次提交时已经冻结。 */
export function freezeChanged(s: Library, delta: LibraryDelta): void {
  for (const { kind, id } of delta.changed)
    freezeEntity((s[kind] as Record<string, unknown>)[id]);
  for (const kind of ENTITY_KINDS) Object.freeze(s[kind]);
}
/** 没写标题时取正文第一行的前 40 个字；按码点数，表情不会被劈成半个。 */
export function recordTitle(r: Stored<RecordContent>): string {
  const line = r.text.trim().split("\n")[0] ?? "";
  // 40 个码点至多 80 个 UTF-16 单位：先截 80 再按码点数，长正文不必整行展开成数组。
  return r.title.trim() || Array.from(line.slice(0, 80)).slice(0, 40).join("") || "这一刻";
}
/**
 * 按上限截断：最多 max 个 UTF-16 单位（校验与服务端都按 .length 计），但不把表情这类代理对劈成两半，
 * 否则存下或发出去的就是半个字符。
 */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = Math.max(0, max);
  const code = text.charCodeAt(end - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? end - 1 : end);
}
export function monthKey(date: string): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
/** 系列条目归属的月份：优先照片拍摄时间，缺省退回记录日期。 */
export function monthOfItem(
  record: { date: string },
  media?: { photoMetadata?: PhotoMetadata },
): string {
  return monthKey(media?.photoMetadata?.capturedAt ?? record.date);
}
export function yearKey(date: string): string {
  return String(new Date(date).getFullYear());
}
/**
 * 按时刻比两个记录日期。库里有两种写法：日期选择器存 UTC（带 Z），照片拍摄时刻存不带时区的本地时间；
 * 按字符串比，UTC+8 相差 8 小时以内的两条会排反。解析不了的退回字符串比。
 */
export function compareDates(a: string, b: string): number {
  return Date.parse(a) - Date.parse(b) || a.localeCompare(b);
}
/**
 * 新的在前。好几页各自要这份排序，一万段时每次几十毫秒：提交后的集合是冻结的（freezeLibrary／
 * freezeChanged），不相干的改动也不换对象，所以按集合对象记住排好的结果；工作副本照排不记。
 */
const sortedCache = new WeakMap<object, readonly Stored<LocalRecord>[]>();
export function sortedRecords(
  s: Pick<Library, "records">,
): readonly Stored<LocalRecord>[] {
  const cached = sortedCache.get(s.records);
  if (cached) return cached;
  const sorted = Object.freeze(newestFirst(Object.values(s.records)));
  if (Object.isFrozen(s.records)) sortedCache.set(s.records, sorted);
  return sorted;
}
/** 新的在前，日期相同按 id；日期只解析一次（比较函数里 Date.parse 一万段要多花三倍）。 */
export function newestFirst<T extends { id: string; date: string }>(
  list: readonly T[],
): T[] {
  return list
    .map((r) => ({ r, t: Date.parse(r.date) }))
    .sort(
      (a, b) =>
        b.t - a.t ||
        b.r.date.localeCompare(a.r.date) ||
        a.r.id.localeCompare(b.r.id),
    )
    .map((k) => k.r);
}
export function recordsOfPerson(
  records: Stored<LocalRecord>[],
  personId: string,
): Stored<LocalRecord>[] {
  return records.filter((r) => r.personIds?.includes(personId));
}

/** 把某个人的标记从全部记录与草稿上改写；只动标记，不动记录。 */
function retagPersons(
  s: Library,
  personId: string,
  retag: (ids: string[]) => string[],
): void {
  const rewrite = (c: Mutable<RecordContent>) => {
    if (!c.personIds?.includes(personId)) return;
    const next = retag(c.personIds);
    if (next.length) c.personIds = next;
    else delete c.personIds;
  };
  const tagged = (c: { personIds?: readonly string[] }) =>
    !!c.personIds?.includes(personId);
  // 记录带上世系：别的手机才认得这一版源自它手里那版，不出假冲突卡。
  for (const [id, record] of Object.entries(s.records))
    if (tagged(record))
      editEntity(s, "records", id, (r) => {
        r.ancestors = lineage(r);
        rewrite(r);
      });
  for (const [id, draft] of Object.entries(s.drafts))
    if (tagged(draft.content))
      editEntity(s, "drafts", id, (next) => {
        rewrite(next.content);
      });
}

/** 删除人物并从全部记录/草稿标记里剥离；只取消标记，不动记录。 */
export function deletePerson(
  s: Library,
  id: string,
  now = new Date().toISOString(),
): void {
  if (!s.persons[id]) throw new Error("没有这个人。");
  tombstone(s, "persons", id, now);
  delete s.persons[id];
  retagPersons(s, id, (ids) => ids.filter((p) => p !== id));
}

/** 把 source 的全部标记并入 target 并删除 source。 */
export function mergePersons(
  s: Library,
  sourceId: string,
  targetId: string,
  now = new Date().toISOString(),
): void {
  if (sourceId === targetId) throw new Error("请选择另一个人来合并。");
  if (!s.persons[sourceId] || !s.persons[targetId])
    throw new Error("没有这个人。");
  tombstone(s, "persons", sourceId, now);
  delete s.persons[sourceId];
  retagPersons(s, sourceId, (ids) => [
    ...new Set(ids.map((p) => (p === sourceId ? targetId : p))),
  ]);
}
/** 还没落款的记录 id：书架「都是{by}写的吗」卡与设置里的落款行都靠它数。 */
export function unsignedRecords(s: Pick<Library, "records">): string[] {
  return Object.keys(s.records).filter((id) => !s.records[id]!.by);
}
/**
 * 给还没落款的记录统一写上 by；返回写了几条。写入 by 与世系，不动 revision 与 updatedAt：
 * 这不是内容编辑，别让它在家人合并时压过对方后来真正的改动。
 */
export function stampUnsigned(s: Library, by: string): number {
  const ids = unsignedRecords(s);
  for (const id of ids) editEntity(s, "records", id, (r) => {
    r.ancestors = lineage(r);
    r.by = by;
  });
  return ids.length;
}
export function referencedMedia(s: Library): Set<string> {
  return new Set([
    ...(s.profile.avatarId ? [s.profile.avatarId] : []),
    ...Object.values(s.records).flatMap((r) => r.mediaIds),
    ...Object.values(s.drafts).flatMap((d) => d.content.mediaIds),
    // 信里的录音与照片也是资料，「清理未使用素材」不能动。
    ...Object.values(s.letters).flatMap((l) => l.mediaIds),
  ]);
}
/**
 * 编辑页写回草稿；返回库里的这一份。原记录与基准版本归库管：同步把被删记录的草稿改成新记录、
 * 阅读页改记录时跟上基准版本，编辑页手里的旧值不能写回去，否则保存一直被「原记录已改变」拦住。
 */
export function updateDraft(s: Library, draft: RecordDraft): RecordDraft {
  const existing = s.drafts[draft.id];
  if (!existing) throw new Error("草稿已关闭，请重新打开。");
  const next = {
    ...clone(draft),
    recordId: existing.recordId,
    baseRevision: existing.baseRevision,
  };
  s.drafts[draft.id] = next;
  return next;
}
export function saveRecord(
  s: Library,
  draftId: string,
  recordId: string,
  now: string,
): LocalRecord {
  const d = s.drafts[draftId];
  if (!d) throw new Error("未找到这份草稿。");
  if (
    !d.content.text.trim() &&
    !d.content.title.trim() &&
    !d.content.mediaIds.length
  )
    throw new Error("写几句话，或加一张照片再保存。");
  if (!Number.isFinite(Date.parse(d.content.date)))
    throw new Error("请选择有效日期。");
  const id = d.recordId ?? recordId;
  const existing = s.records[id];
  if (d.recordId && (!existing || existing.revision !== d.baseRevision))
    throw new Error("原记录已改变，草稿仍已保留，请返回核对；要按新的记录重写，先点右上角垃圾桶放弃这份草稿。");
  if (d.content.mediaIds.some((id) => !s.media[id]))
    throw new Error("有素材尚未保存完整，请重试。");
  const r: LocalRecord = {
    ...clone(d.content),
    id,
    revision: (existing?.revision ?? 0) + 1,
    updatedAt: now,
  };
  if (existing) r.ancestors = lineage(existing);
  else delete r.ancestors; // 草稿可能由旧记录复制而来，新记录不继承世系。
  s.records[id] = r;
  delete s.drafts[draftId];
  clearUnavailableCovers(s);
  return r;
}
/**
 * 阅读页直接改记录的几项（第一次、她说的话、地点）：记录升一版。这条记录若有基于上一版的编辑草稿，
 * 草稿里没动过的那几项跟着改、基准版本跟上，免得之后保存一直被「原记录已改变」拦住；
 * 草稿里改过的项保留草稿的写法。
 */
export function patchRecord(
  s: Library,
  id: string,
  patch: Partial<Pick<RecordContent, "first" | "quote" | "location">>,
  now: string,
): void {
  const before = s.records[id];
  if (!before) return;
  editEntity(s, "records", id, (r) => {
    r.ancestors = lineage(r);
    Object.assign(r, patch);
    r.revision++;
    r.updatedAt = now;
  });
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  for (const d of Object.values(s.drafts)) {
    if (d.recordId !== id || d.baseRevision !== before.revision) continue;
    editEntity(s, "drafts", d.id, (next) => {
      // 旧记录没有 quote 字段、地点可能是空串：都按「没有」比。
      for (const key of keys)
        if ((next.content[key] || false) === (before[key] || false))
          Object.assign(next.content, { [key]: patch[key] });
      next.baseRevision = before.revision + 1;
    });
  }
}
export function deleteRecord(
  s: Library,
  id: string,
  now = new Date().toISOString(),
): void {
  if (s.records[id]) tombstone(s, "records", id, now);
  delete s.records[id];
  for (const [key, d] of Object.entries(s.drafts))
    if (d.recordId === id) delete s.drafts[key];
  for (const [key, album] of Object.entries(s.albums))
    if (album.items.some((i) => i.recordId === id))
      editEntity(s, "albums", key, (a) => {
        a.items = a.items.filter((i) => i.recordId !== id);
      });
  for (const [key, selection] of Object.entries(s.selections))
    if (selection.selected.includes(id))
      editEntity(s, "selections", key, (q) => {
        q.selected = q.selected.filter((x) => x !== id);
      });
  for (const [key, series] of Object.entries(s.series))
    if (series.items.some((i) => i.recordId === id))
      editEntity(s, "series", key, (t) => {
        t.items = t.items.filter((i) => i.recordId !== id);
      });
  clearUnavailableCovers(s);
}
/** 删相册：其中的记录保留；指着它的选材会话一并关掉。 */
export function deleteAlbum(
  s: Library,
  id: string,
  now = new Date().toISOString(),
): void {
  if (!s.albums[id]) return;
  tombstone(s, "albums", id, now);
  delete s.albums[id];
  for (const [key, q] of Object.entries(s.selections))
    if (q.albumId === id) delete s.selections[key];
}
/** 删时光系列：照片与记录都保留。 */
export function deleteSeries(
  s: Library,
  id: string,
  now = new Date().toISOString(),
): void {
  if (!s.series[id]) return;
  tombstone(s, "series", id, now);
  delete s.series[id];
}
/** 删信：录音留给「清理未使用素材」。 */
export function deleteLetter(
  s: Library,
  id: string,
  now = new Date().toISOString(),
): void {
  if (!s.letters[id]) return;
  tombstone(s, "letters", id, now);
  delete s.letters[id];
}
function clearUnavailableCovers(s: Library): void {
  for (const [key, album] of Object.entries(s.albums))
    if (
      album.coverId &&
      !album.items.some((i) =>
        s.records[i.recordId]?.mediaIds.includes(album.coverId!),
      )
    )
      editEntity(s, "albums", key, (a) => {
        a.coverId = null;
      });
  for (const [key, selection] of Object.entries(s.selections))
    if (
      selection.coverId &&
      !selection.selected.some((id) =>
        s.records[id]?.mediaIds.includes(selection.coverId!),
      )
    )
      editEntity(s, "selections", key, (q) => {
        q.coverId = null;
      });
  // 记录编辑删掉某张照片时，系列里指向它的条目一并退场。
  const present = (i: { recordId: string; mediaId: string }) =>
    !!s.records[i.recordId]?.mediaIds.includes(i.mediaId);
  for (const [key, series] of Object.entries(s.series))
    if (!series.items.every(present))
      editEntity(s, "series", key, (t) => {
        t.items = t.items.filter(present);
      });
}
export function finishSelection(
  s: Library,
  sessionId: string,
  albumId: string,
  itemId: () => string,
  now: string,
): Stored<LocalAlbum> {
  const session = s.selections[sessionId];
  if (!session) throw new Error("未找到选材内容。");
  if (!session.selected.length) throw new Error("请先选择记录。");
  const existingAlbum = session.albumId ? s.albums[session.albumId] : null;
  if (session.albumId && !existingAlbum) throw new Error("相册已删除。");
  const album: LocalAlbum = existingAlbum
    ? { ...existingAlbum, items: [...existingAlbum.items] }
    : {
        id: albumId,
        name: session.name.trim() || "新相册",
        items: [],
        coverId: session.coverId,
        updatedAt: now,
      };
  const existing = new Set(album.items.map((i) => i.recordId));
  for (const id of session.selected) {
    if (!s.records[id]) throw new Error("所选记录已删除，请重新选择。");
    if (!existing.has(id)) {
      album.items.push({ id: itemId(), recordId: id });
      existing.add(id);
    }
  }
  album.updatedAt = now;
  s.albums[album.id] = album;
  delete s.selections[sessionId];
  return album;
}

/** 把几条记录追加进已有相册：去重、不经过选材页；没有新记录时不动 updatedAt。 */
export function appendToAlbum(
  s: Library,
  albumId: string,
  recordIds: readonly string[],
  itemId: () => string,
  now: string,
): Stored<LocalAlbum> {
  const album = s.albums[albumId];
  if (!album) throw new Error("相册已删除。");
  const ids = [...new Set(recordIds)];
  for (const id of ids) if (!s.records[id]) throw new Error("这段时光已删除。");
  const existing = new Set(album.items.map((i) => i.recordId));
  const added = ids.filter((id) => !existing.has(id));
  if (!added.length) return album;
  const next: LocalAlbum = {
    ...album,
    items: [
      ...album.items,
      ...added.map((recordId) => ({ id: itemId(), recordId })),
    ],
    updatedAt: now,
  };
  s.albums[albumId] = next;
  return next;
}
/** 用这几条记录直接建一本相册：名字缺省「新相册」，封面取第一条记录的封面照。 */
export function newAlbumFrom(
  s: Library,
  albumId: string,
  recordIds: readonly string[],
  itemId: () => string,
  now: string,
  name = "",
): Stored<LocalAlbum> {
  const ids = [...new Set(recordIds)];
  if (!ids.length) throw new Error("请先选择记录。");
  for (const id of ids) if (!s.records[id]) throw new Error("这段时光已删除。");
  const first = s.records[ids[0]!]!;
  const coverId =
    first.coverId && s.media[first.coverId]?.kind === "image"
      ? first.coverId
      : (first.mediaIds.find((m) => s.media[m]?.kind === "image") ?? null);
  const album: LocalAlbum = {
    id: albumId,
    name: name.trim() || "新相册",
    items: ids.map((recordId) => ({ id: itemId(), recordId })),
    coverId,
    updatedAt: now,
  };
  s.albums[albumId] = album;
  return album;
}

/** Strict boundary for disk and user-selected backups, before changing live data. */
const invalidLibrary = () => new Error("本机资料格式无效或版本不支持。");
const isText = (v: unknown) => typeof v === "string";
const isId = (v: unknown) =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const isIds = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(isId) && new Set(v).size === v.length;
const isMap = (v: unknown) =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).every(isId);
const isPlainMap = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
/** 版本时刻：ISO 形状、解析得出、长度有限（不收任意长串）。 */
const isTime = (v: unknown) =>
  typeof v === "string" && v.length <= 32 && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const isFileName = (v: unknown) =>
  typeof v === "string" && /^[a-zA-Z0-9_-]+\.[a-z0-9]{1,8}$/.test(v);
/** 落款：缺省，或 1–20 字且首尾无空白。 */
const validBy = (v: unknown) =>
  v === undefined ||
  (typeof v === "string" &&
    v.length >= 1 &&
    v.length <= BY_LIMIT &&
    v === v.trim());
/** 记录与草稿正文共用的一段：文字、日期，以及素材与人物引用都要落到实处。 */
function validContent(s: Library, c: Stored<RecordContent>): boolean {
  return (
    !!c &&
    isText(c.title) &&
    isText(c.text) &&
    isText(c.location) &&
    isText(c.date) &&
    Number.isFinite(Date.parse(c.date)) &&
    typeof c.first === "boolean" &&
    (c.quote === undefined || typeof c.quote === "boolean") &&
    (c.story === undefined ||
      c.story === "birth" ||
      c.story === "pregnancy" ||
      c.story === "name" ||
      c.story === "met") &&
    validBy(c.by) &&
    isIds(c.mediaIds) &&
    c.mediaIds.every((i) => !!s.media[i]) &&
    (c.coverId === null || c.mediaIds.includes(c.coverId)) &&
    (c.personIds === undefined ||
      (isIds(c.personIds) && c.personIds.every((p) => !!s.persons[p])))
  );
}
/** 本机每日问题缓存：日期须为真实日历日，历史只留短问题。 */
function validDailyQuestion(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object") return false;
  const cache = value as DailyQuestionCache;
  const day = (v: unknown): v is string =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  const question = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 60;
  return (
    day(cache.requestedDay) &&
    (cache.day === undefined || day(cache.day)) &&
    (cache.question === undefined || question(cache.question)) &&
    Array.isArray(cache.asked) && cache.asked.length <= 14 &&
    cache.asked.every((entry) => !!entry && day(entry.day) && question(entry.question))
  );
}

/** 目录可以暂时引用已删记录，装订与同步整理时剔除；坏格式则拒绝整库。 */
function validYearPicks(value: Library["yearPicks"]): boolean {
  if (value === undefined) return true;
  if (!isMap(value)) return false;
  const trimmed = (v: unknown, max: number): v is string =>
    typeof v === "string" && v === v.trim() && v.length > 0 && [...v].length <= max;
  return Object.entries(value!).every(([year, picks]) => {
    if (!/^\d{4}$/.test(year) || !isMap(picks) || !isMap(picks.months) ||
      (picks.title !== undefined && !trimmed(picks.title, 20)) ||
      (picks.notes !== undefined && (typeof picks.notes !== "string" || [...picks.notes].length > 200)) ||
      typeof picks.updatedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T/.test(picks.updatedAt) || !Number.isFinite(Date.parse(picks.updatedAt))) return false;
    const seen = new Set<string>();
    return Object.entries(picks.months).every(([month, entry]) => {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !month.startsWith(`${year}-`) ||
        !isMap(entry) || !isIds(entry.recordIds) || entry.recordIds.length < 1 || entry.recordIds.length > 3 ||
        entry.recordIds.some((id) => seen.has(id)) ||
        (entry.quote !== undefined && (!isMap(entry.quote) || !isId(entry.quote.recordId) || !trimmed(entry.quote.text, 40)))) return false;
      entry.recordIds.forEach((id) => seen.add(id));
      return true;
    });
  });
}

/** 根字段。avatarId 指向素材，所以要看整库。 */
function validRoot(s: Library): boolean {
  return (
    s.version === 1 &&
    Number.isInteger(s.revision) &&
    s.revision >= 0 &&
    typeof s.welcome === "boolean" &&
    !!s.yearNotes &&
    typeof s.yearNotes === "object" &&
    !Array.isArray(s.yearNotes) &&
    !Object.entries(s.yearNotes).some(
      ([year, note]) =>
        !/^\d{4}$/.test(year) || typeof note !== "string" || note.length > 2000,
    ) &&
    !!s.yearCovers &&
    typeof s.yearCovers === "object" &&
    !Array.isArray(s.yearCovers) &&
    // 素材可能在选完封面后被删掉；那只是回落到自动封面，不该让整库打不开。
    !Object.entries(s.yearCovers).some(
      ([year, id]) => !/^\d{4}$/.test(year) || !isId(id),
    ) &&
    validYearPicks(s.yearPicks) &&
    (s.yearBooksBoundAt === undefined ||
      (!!s.yearBooksBoundAt &&
        typeof s.yearBooksBoundAt === "object" &&
        !Array.isArray(s.yearBooksBoundAt) &&
        !Object.entries(s.yearBooksBoundAt).some(
          ([year, at]) =>
            !/^\d{4}$/.test(year) ||
            !isText(at) ||
            !Number.isFinite(Date.parse(at)),
        ))) &&
    (s.nudgeClosedAt === undefined ||
      (!!s.nudgeClosedAt &&
        typeof s.nudgeClosedAt === "object" &&
        !Array.isArray(s.nudgeClosedAt) &&
        !Object.entries(s.nudgeClosedAt).some(
          ([kind, at]) =>
            !/^[a-z-]{1,32}$/.test(kind) ||
            !isText(at) ||
            !Number.isFinite(Date.parse(at)),
        ))) &&
    (s.rootStamps === undefined ||
      (isPlainMap(s.rootStamps) &&
        Object.entries(s.rootStamps).every(
          ([key, at]) => ROOT_STAMP_KEY.test(key) && isTime(at),
        ))) &&
    (s.tombstones === undefined ||
      (!!s.tombstones &&
        typeof s.tombstones === "object" &&
        !Array.isArray(s.tombstones) &&
        !Object.entries(s.tombstones).some(
          ([key, at]) =>
            !TOMBSTONE_KEY.test(key) ||
            !isText(at) ||
            !Number.isFinite(Date.parse(at)),
        ))) &&
    !!s.profile &&
    isText(s.profile.name) &&
    (s.profile.fullName === undefined ||
      (typeof s.profile.fullName === "string" &&
        s.profile.fullName === s.profile.fullName.trim() &&
        s.profile.fullName.length > 0 && s.profile.fullName.length <= 20)) &&
    (s.profile.motto === undefined ||
      (typeof s.profile.motto === "string" &&
        s.profile.motto === s.profile.motto.trim() &&
        s.profile.motto.length > 0 && s.profile.motto.length <= 60)) &&
    isText(s.profile.birthday) &&
    (s.profile.avatarId === null || isId(s.profile.avatarId)) &&
    !!s.settings &&
    ["auto", "light", "dark"].includes(s.settings.theme) &&
    typeof s.settings.largeText === "boolean" &&
    (s.settings.transcribeConsent === undefined ||
      typeof s.settings.transcribeConsent === "boolean") &&
    (s.settings.lockEnabled === undefined ||
      typeof s.settings.lockEnabled === "boolean") &&
    validBy(s.settings.by) &&
    validDailyQuestion(s.settings.dailyQuestion) &&
    isIds(s.receivedShares) &&
    (s.lastExportAt === undefined ||
      (isText(s.lastExportAt) &&
        Number.isFinite(Date.parse(s.lastExportAt)))) &&
    (!s.profile.avatarId || s.media[s.profile.avatarId]?.kind === "image")
  );
}
const validAncestors = (value: unknown): boolean =>
  value === undefined ||
  (Array.isArray(value) && value.length <= 8 &&
    value.every((hash) => typeof hash === "string" && /^[a-f0-9]{16}$/.test(hash)));
/** 一个实体自身的形状，以及它指向的东西是否都还在。 */
function validEntity(s: Library, kind: EntityKind, key: string): boolean {
  if (!isId(key)) return false;
  if (kind === "media") {
    const m = s.media[key];
    return (
      !!m &&
      key === m.id &&
      isFileName(m.file) &&
      isText(m.name) &&
      ["image", "video", "audio", "document"].includes(m.kind) &&
      Number.isSafeInteger(m.bytes) &&
      m.bytes >= 1 &&
      /^[a-f0-9]{64}$/.test(m.sha256) &&
      (m.thumb === undefined || isFileName(m.thumb)) &&
      ((m.width === undefined && m.height === undefined) ||
        (Number.isSafeInteger(m.width) &&
          Number.isSafeInteger(m.height) &&
          (m.width ?? 0) >= 1 &&
          (m.height ?? 0) >= 1)) &&
      (m.photoMetadata === undefined ||
        (!!m.photoMetadata &&
          typeof m.photoMetadata === "object" &&
          (m.photoMetadata.capturedAt === undefined ||
            (isText(m.photoMetadata.capturedAt) &&
              Number.isFinite(Date.parse(m.photoMetadata.capturedAt)))) &&
          ((m.photoMetadata.latitude === undefined &&
            m.photoMetadata.longitude === undefined) ||
            (typeof m.photoMetadata.latitude === "number" &&
              Number.isFinite(m.photoMetadata.latitude) &&
              Math.abs(m.photoMetadata.latitude) <= 90 &&
              typeof m.photoMetadata.longitude === "number" &&
              Number.isFinite(m.photoMetadata.longitude) &&
              Math.abs(m.photoMetadata.longitude) <= 180))))
    );
  }
  if (kind === "records") {
    const r = s.records[key];
    return (
      !!r &&
      key === r.id &&
      validContent(s, r) &&
      validAncestors(r.ancestors) &&
      Number.isInteger(r.revision) &&
      r.revision >= 1 &&
      Number.isFinite(Date.parse(r.updatedAt))
    );
  }
  if (kind === "drafts") {
    const d = s.drafts[key];
    return (
      !!d &&
      key === d.id &&
      validContent(s, d.content) &&
      validateStoredAI(d.aiJob) &&
      validateStoredAI(d.aiProposal) &&
      (d.autoDate === undefined || typeof d.autoDate === "boolean") &&
      (d.autoLocation === undefined || typeof d.autoLocation === "boolean") &&
      (d.recordId === null || !!s.records[d.recordId]) &&
      Number.isInteger(d.baseRevision) &&
      Number.isFinite(Date.parse(d.updatedAt)) &&
      (d.recordingFile === undefined ||
        /^(?:(?:Audio|ExpoAudio)\/)?[a-zA-Z0-9_-]+\.m4a$/.test(d.recordingFile))
    );
  }
  if (kind === "albums") {
    const a = s.albums[key];
    return (
      !!a &&
      key === a.id &&
      isText(a.name) &&
      (a.note === undefined ||
        (typeof a.note === "string" && a.note.length <= 2000)) &&
      Array.isArray(a.items) &&
      isIds(a.items.map((i) => i.id)) &&
      isIds(a.items.map((i) => i.recordId)) &&
      !a.items.some((i) => !s.records[i.recordId]) &&
      Number.isFinite(Date.parse(a.updatedAt)) &&
      (a.coverId === null ||
        a.items.some((i) =>
          s.records[i.recordId]?.mediaIds.includes(a.coverId!),
        ))
    );
  }
  if (kind === "selections") {
    const q = s.selections[key];
    return (
      !!q &&
      key === q.id &&
      isIds(q.selected) &&
      !q.selected.some((i) => !s.records[i]) &&
      (q.albumId === null || !!s.albums[q.albumId]) &&
      isText(q.month) &&
      isText(q.name) &&
      Number.isFinite(q.offset) &&
      q.offset >= 0 &&
      (q.coverId === null ||
        q.selected.some((i) => s.records[i]?.mediaIds.includes(q.coverId!)))
    );
  }
  if (kind === "series") {
    const v = s.series[key];
    return (
      !!v &&
      key === v.id &&
      isText(v.name) &&
      v.name.length <= 100 &&
      Array.isArray(v.items) &&
      isIds(v.items.map((i) => i.recordId)) &&
      isIds(v.items.map((i) => i.mediaId)) &&
      !v.items.some(
        (i) =>
          !s.records[i.recordId] ||
          !s.records[i.recordId]!.mediaIds.includes(i.mediaId) ||
          s.media[i.mediaId]?.kind !== "image" ||
          !/^\d{4}-(0[1-9]|1[0-2])$/.test(i.month),
      ) &&
      new Set(v.items.map((i) => i.month)).size === v.items.length &&
      Number.isFinite(Date.parse(v.updatedAt))
    );
  }
  if (kind === "letters") {
    const l = s.letters[key];
    return (
      !!l &&
      key === l.id &&
      validAncestors(l.ancestors) &&
      isText(l.title) &&
      l.title.length <= LETTER_TITLE_LIMIT &&
      isText(l.text) &&
      l.text.length <= LETTER_TEXT_LIMIT &&
      isText(l.from) &&
      l.from.length <= LETTER_FROM_LIMIT &&
      /^\d{4}-\d{2}-\d{2}$/.test(l.openAt) &&
      Number.isFinite(Date.parse(`${l.openAt}T00:00:00`)) &&
      Number.isFinite(Date.parse(l.writtenAt)) &&
      typeof l.sealed === "boolean" &&
      (l.openedAt === undefined ||
        (isText(l.openedAt) && Number.isFinite(Date.parse(l.openedAt)))) &&
      isIds(l.mediaIds) &&
      l.mediaIds.every((i) => !!s.media[i]) &&
      (l.coverId === null || l.mediaIds.includes(l.coverId)) &&
      Number.isFinite(Date.parse(l.updatedAt))
    );
  }
  const p = s.persons[key];
  return (
    !!p &&
    key === p.id &&
    (p.updatedAt === undefined || isTime(p.updatedAt)) &&
    isText(p.name) &&
    p.name.trim().length >= 1 &&
    p.name.length <= 50
  );
}
/** Strict boundary for disk and user-selected backups. */
export function validateLibrary(value: unknown): asserts value is Library {
  if (!value || typeof value !== "object") throw invalidLibrary();
  const s = value as Library;
  if (!ENTITY_KINDS.every((kind) => isMap(s[kind]))) throw invalidLibrary();
  if (!validRoot(s)) throw invalidLibrary();
  for (const kind of ENTITY_KINDS)
    for (const key of Object.keys(s[kind]))
      if (!validEntity(s, kind, key)) throw invalidLibrary();
}
/** 没有别的实体或库根指向它们（validEntity／validRoot 里没有 s.drafts／s.selections 的引用）：删掉只影响自己。 */
export const LEAF_KINDS: readonly EntityKind[] = ["drafts", "selections"];
/**
 * 一次 change 之后的校验。只增只改时只看根与动过的那几条；删了别处可能指向的实体就整库重来
 * ——删掉一条记录会让相册、选材、系列里指向它的引用一起失效，只看改动是看不见的。
 * 保存记录总会删掉它的草稿：草稿没人指向，不必为它整库重验（一万段时每次保存省下六十毫秒）。
 */
export function validateChange(s: Library, delta: LibraryDelta): void {
  if (delta.removed.some(({ kind }) => !LEAF_KINDS.includes(kind)))
    return validateLibrary(s);
  if (!validRoot(s)) throw invalidLibrary();
  for (const { kind, id } of delta.changed)
    if (!validEntity(s, kind, id)) throw invalidLibrary();
}
