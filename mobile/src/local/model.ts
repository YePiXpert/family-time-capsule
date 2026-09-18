import type { AIJob, AIProposal } from "../ai/types";
import { validateStoredAI } from "../ai/state";
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
};
export type LocalRecord = RecordContent & {
  id: string;
  revision: number;
  updatedAt: string;
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
  groupPhotosByDay?: boolean;
  manualLocation?: boolean;
  photoEvents?: RecordContent[];
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
export type LocalSeries = {
  id: string;
  name: string;
  items: SeriesItem[];
  updatedAt: string;
};
export type LocalPerson = { id: string; name: string };
export type LocalProfile = {
  name: string;
  birthday: string;
  avatarId: string | null;
};
/** 库里存着的实体是只读的：一次 change 里只能整个替换（见 editEntity），
 * 不能原地改——共享的是同一个对象，原地改会当场污染界面上的当前状态。 */
export type Stored<T> = {
  readonly [K in keyof T]: T[K] extends (infer U)[] ? readonly U[] : T[K];
};
export type Library = {
  version: 1;
  revision: number;
  welcome: boolean;
  profile: LocalProfile;
  settings: {
    theme: "auto" | "light" | "dark";
    largeText: boolean;
    lockEnabled?: boolean;
    /** 年度重放的配乐：本机音频素材 id；缺省或空表示不配乐。 */
    replayAudioId?: string;
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
  /** 「爸爸妈妈的话」annual notes, keyed by four-digit year like "2026". */
  yearNotes: Record<string, string>;
  receivedShares: string[];
  /** ISO timestamp of the last successful export; undefined until the first one. */
  lastExportAt?: string;
};
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
  yearNotes: {},
  receivedShares: [],
});
/** Fills fields added after the first release so older stores and backups still open. */
export function normalizeLibrary(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const s = value as Partial<Library>;
  if (s.yearNotes === undefined) s.yearNotes = {};
  if (s.series === undefined) s.series = {};
  if (s.persons === undefined) s.persons = {};
  // 指向已删除人物的标记会让 validateLibrary 拒绝整库。打开与解码备份时先剥掉，
  // 让校验只在「本次改动写坏了」时报错，而不是把人锁在自己的资料外面。
  const persons = s.persons ?? {};
  // 这里拿到的还是刚解析出来的裸对象，尚未进库也尚未冻结，可以原地改。
  for (const content of [
    ...Object.values(s.records ?? {}),
    ...Object.values(s.drafts ?? {}).flatMap((d) => [
      d?.content,
      ...(d?.photoEvents ?? []),
    ]),
  ] as (Mutable<RecordContent> | undefined)[]) {
    const tags = content?.personIds;
    if (!Array.isArray(tags)) continue;
    const kept = tags.filter((p) => !!persons[p]);
    if (kept.length === tags.length) continue;
    if (kept.length) content!.personIds = kept;
    else delete content!.personIds;
  }
}
export const emptyContent = (): RecordContent => ({
  title: "",
  text: "",
  date: new Date().toISOString(),
  location: "",
  first: false,
  mediaIds: [],
  coverId: null,
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
    receivedShares: [...s.receivedShares],
    records: { ...s.records },
    drafts: { ...s.drafts },
    media: { ...s.media },
    albums: { ...s.albums },
    selections: { ...s.selections },
    series: { ...s.series },
    persons: { ...s.persons },
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
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const inner of Object.values(value)) freezeEntity(inner);
  return value;
}
/** 开库后冻结全部实体；此后只有 change 里替换进来的新实体需要再冻结。 */
export function freezeLibrary(s: Library): void {
  for (const kind of ENTITY_KINDS)
    for (const entity of Object.values(s[kind])) freezeEntity(entity);
}
export function recordTitle(r: Stored<RecordContent>): string {
  return (
    r.title.trim() || r.text.trim().split("\n")[0]?.slice(0, 40) || "这一刻"
  );
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
/** 把 "YYYY-MM" 折成可比加减的序号。 */
export function monthIndex(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return y! * 12 + (m! - 1);
}
export function indexMonth(index: number): string {
  const y = Math.floor(index / 12),
    m = (index % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
export function sortedRecords(s: Library): Stored<LocalRecord>[] {
  return Object.values(s.records).sort(
    (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
  );
}
export function recordsOfPerson(
  records: Stored<LocalRecord>[],
  personId: string,
): Stored<LocalRecord>[] {
  return records.filter((r) => r.personIds?.includes(personId));
}

/** 把某个人的标记从全部记录与草稿（含「按事情分组」的每件事）上改写；只动标记，不动记录。 */
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
  for (const [id, record] of Object.entries(s.records))
    if (tagged(record)) editEntity(s, "records", id, rewrite);
  for (const [id, draft] of Object.entries(s.drafts))
    if (tagged(draft.content) || draft.photoEvents?.some(tagged))
      editEntity(s, "drafts", id, (next) => {
        rewrite(next.content);
        for (const event of next.photoEvents ?? []) rewrite(event);
      });
}

/** 删除人物并从全部记录/草稿标记里剥离；只取消标记，不动记录。 */
export function deletePerson(s: Library, id: string): void {
  if (!s.persons[id]) throw new Error("没有这个人。");
  delete s.persons[id];
  retagPersons(s, id, (ids) => ids.filter((p) => p !== id));
}

/** 把 source 的全部标记并入 target 并删除 source。 */
export function mergePersons(
  s: Library,
  sourceId: string,
  targetId: string,
): void {
  if (sourceId === targetId) throw new Error("请选择另一个人来合并。");
  if (!s.persons[sourceId] || !s.persons[targetId])
    throw new Error("没有这个人。");
  delete s.persons[sourceId];
  retagPersons(s, sourceId, (ids) => [
    ...new Set(ids.map((p) => (p === sourceId ? targetId : p))),
  ]);
}
export function referencedMedia(s: Library): Set<string> {
  return new Set([
    ...(s.profile.avatarId ? [s.profile.avatarId] : []),
    // 用户为年度重放亲自选的配乐，即使在记录被删后也保留，避免静默换歌或丢失。
    ...(s.settings.replayAudioId ? [s.settings.replayAudioId] : []),
    ...Object.values(s.records).flatMap((r) => r.mediaIds),
    ...Object.values(s.drafts).flatMap((d) => d.content.mediaIds),
  ]);
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
    throw new Error("写几句话，或添加一份素材再保存。");
  if (!Number.isFinite(Date.parse(d.content.date)))
    throw new Error("请选择有效日期。");
  const id = d.recordId ?? recordId;
  const existing = s.records[id];
  if (d.recordId && (!existing || existing.revision !== d.baseRevision))
    throw new Error("原记录已改变，草稿仍已保留，请返回核对。");
  if (d.content.mediaIds.some((id) => !s.media[id]))
    throw new Error("有素材尚未保存完整，请重试。");
  const r: LocalRecord = {
    ...clone(d.content),
    id,
    revision: (existing?.revision ?? 0) + 1,
    updatedAt: now,
  };
  s.records[id] = r;
  delete s.drafts[draftId];
  clearUnavailableCovers(s);
  return r;
}
export function deleteRecord(s: Library, id: string): void {
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
  // 配乐素材在 referencedMedia 里受保护；这里兜住外部写坏的悬空 id。
  if (
    s.settings.replayAudioId &&
    s.media[s.settings.replayAudioId]?.kind !== "audio"
  )
    delete s.settings.replayAudioId;
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

/** Strict boundary for disk and user-selected backups, before changing live data. */
export function validateLibrary(value: unknown): asserts value is Library {
  const fail = () => {
    throw new Error("本机资料格式无效或版本不支持。");
  };
  if (!value || typeof value !== "object") return fail();
  const s = value as Library;
  if (
    s.version !== 1 ||
    !Number.isInteger(s.revision) ||
    s.revision < 0 ||
    typeof s.welcome !== "boolean"
  )
    return fail();
  const str = (v: unknown) => typeof v === "string";
  const id = (v: unknown) =>
    typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
  const ids = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every(id) && new Set(v).size === v.length;
  const map = (v: unknown) =>
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).every(id);
  if (![s.records, s.drafts, s.media, s.albums, s.selections].every(map))
    return fail();
  if (
    !s.yearNotes ||
    typeof s.yearNotes !== "object" ||
    Array.isArray(s.yearNotes) ||
    Object.entries(s.yearNotes).some(
      ([year, note]) =>
        !/^\d{4}$/.test(year) || typeof note !== "string" || note.length > 2000,
    )
  )
    return fail();
  if (
    !s.profile ||
    !str(s.profile.name) ||
    !str(s.profile.birthday) ||
    (s.profile.avatarId !== null && !id(s.profile.avatarId))
  )
    return fail();
  if (
    !s.settings ||
    !["auto", "light", "dark"].includes(s.settings.theme) ||
    typeof s.settings.largeText !== "boolean" ||
    (s.settings.lockEnabled !== undefined &&
      typeof s.settings.lockEnabled !== "boolean") ||
    (s.settings.replayAudioId !== undefined &&
      (typeof s.settings.replayAudioId !== "string" ||
        s.media[s.settings.replayAudioId]?.kind !== "audio")) ||
    !ids(s.receivedShares) ||
    (s.lastExportAt !== undefined &&
      (!str(s.lastExportAt) || !Number.isFinite(Date.parse(s.lastExportAt))))
  )
    return fail();
  for (const [key, m] of Object.entries(s.media))
    if (
      key !== m.id ||
      !/^[a-zA-Z0-9_-]+\.[a-z0-9]{1,8}$/.test(m.file) ||
      !str(m.name) ||
      !["image", "video", "audio", "document"].includes(m.kind) ||
      !Number.isSafeInteger(m.bytes) ||
      m.bytes < 1 ||
      !/^[a-f0-9]{64}$/.test(m.sha256) ||
      (m.thumb !== undefined &&
        !/^[a-zA-Z0-9_-]+\.[a-z0-9]{1,8}$/.test(m.thumb)) ||
      ((m.width !== undefined || m.height !== undefined) &&
        (!Number.isSafeInteger(m.width) ||
          !Number.isSafeInteger(m.height) ||
          (m.width ?? 0) < 1 ||
          (m.height ?? 0) < 1)) ||
      (m.photoMetadata !== undefined &&
        (!m.photoMetadata ||
          typeof m.photoMetadata !== "object" ||
          (m.photoMetadata.capturedAt !== undefined &&
            (!str(m.photoMetadata.capturedAt) ||
              !Number.isFinite(Date.parse(m.photoMetadata.capturedAt)))) ||
          ((m.photoMetadata.latitude !== undefined ||
            m.photoMetadata.longitude !== undefined) &&
            (typeof m.photoMetadata.latitude !== "number" ||
              !Number.isFinite(m.photoMetadata.latitude) ||
              Math.abs(m.photoMetadata.latitude) > 90 ||
              typeof m.photoMetadata.longitude !== "number" ||
              !Number.isFinite(m.photoMetadata.longitude) ||
              Math.abs(m.photoMetadata.longitude) > 180))))
    )
      return fail();
  const content = (c: Stored<RecordContent>) =>
    c &&
    str(c.title) &&
    str(c.text) &&
    str(c.location) &&
    str(c.date) &&
    Number.isFinite(Date.parse(c.date)) &&
    typeof c.first === "boolean" &&
    ids(c.mediaIds) &&
    c.mediaIds.every((i) => !!s.media[i]) &&
    (c.coverId === null || c.mediaIds.includes(c.coverId)) &&
    (c.personIds === undefined ||
      (ids(c.personIds) && c.personIds.every((p) => !!s.persons[p])));
  for (const [key, r] of Object.entries(s.records))
    if (
      key !== r.id ||
      !content(r) ||
      !Number.isInteger(r.revision) ||
      r.revision < 1 ||
      !Number.isFinite(Date.parse(r.updatedAt))
    )
      return fail();
  for (const [key, d] of Object.entries(s.drafts))
    if (
      key !== d.id ||
      !content(d.content) ||
      !validateStoredAI(d.aiJob) ||
      !validateStoredAI(d.aiProposal) ||
      (d.autoDate !== undefined && typeof d.autoDate !== "boolean") ||
      (d.groupPhotosByDay !== undefined &&
        typeof d.groupPhotosByDay !== "boolean") ||
      (d.manualLocation !== undefined &&
        typeof d.manualLocation !== "boolean") ||
      (d.photoEvents !== undefined &&
        (!Array.isArray(d.photoEvents) ||
          d.photoEvents.some(
            (event) =>
              !event ||
              !str(event.title) ||
              !str(event.text) ||
              !str(event.location) ||
              !str(event.date) ||
              !Number.isFinite(Date.parse(event.date)) ||
              typeof event.first !== "boolean" ||
              !ids(event.mediaIds) ||
              (event.coverId !== null && !id(event.coverId)) ||
              (event.personIds !== undefined &&
                (!ids(event.personIds) ||
                  !event.personIds.every((p) => !!s.persons[p]))),
          ))) ||
      (d.autoLocation !== undefined && typeof d.autoLocation !== "boolean") ||
      (d.recordId !== null && !s.records[d.recordId]) ||
      !Number.isInteger(d.baseRevision) ||
      !Number.isFinite(Date.parse(d.updatedAt)) ||
      (d.recordingFile !== undefined &&
        !/^(?:(?:Audio|ExpoAudio)\/)?[a-zA-Z0-9_-]+\.m4a$/.test(
          d.recordingFile,
        ))
    )
      return fail();
  for (const [key, a] of Object.entries(s.albums))
    if (
      key !== a.id ||
      !str(a.name) ||
      (a.note !== undefined &&
        (typeof a.note !== "string" || a.note.length > 2000)) ||
      !Array.isArray(a.items) ||
      !ids(a.items.map((i) => i.id)) ||
      !ids(a.items.map((i) => i.recordId)) ||
      a.items.some((i) => !s.records[i.recordId]) ||
      !Number.isFinite(Date.parse(a.updatedAt)) ||
      (a.coverId !== null &&
        !a.items.some((i) =>
          s.records[i.recordId]?.mediaIds.includes(a.coverId!),
        ))
    )
      return fail();
  for (const [key, q] of Object.entries(s.selections))
    if (
      key !== q.id ||
      !ids(q.selected) ||
      q.selected.some((i) => !s.records[i]) ||
      (q.albumId !== null && !s.albums[q.albumId]) ||
      !str(q.month) ||
      !str(q.name) ||
      !Number.isFinite(q.offset) ||
      q.offset < 0 ||
      (q.coverId !== null &&
        !q.selected.some((i) => s.records[i]?.mediaIds.includes(q.coverId!)))
    )
      return fail();
  if (
    !s.series ||
    typeof s.series !== "object" ||
    Array.isArray(s.series) ||
    !Object.keys(s.series).every(id) ||
    Object.entries(s.series).some(
      ([key, v]) =>
        key !== v.id ||
        !str(v.name) ||
        v.name.length > 100 ||
        !Array.isArray(v.items) ||
        !ids(v.items.map((i) => i.recordId)) ||
        !ids(v.items.map((i) => i.mediaId)) ||
        v.items.some(
          (i) =>
            !s.records[i.recordId] ||
            !s.records[i.recordId]!.mediaIds.includes(i.mediaId) ||
            s.media[i.mediaId]?.kind !== "image" ||
            !/^\d{4}-(0[1-9]|1[0-2])$/.test(i.month),
        ) ||
        new Set(v.items.map((i) => i.month)).size !== v.items.length ||
        !Number.isFinite(Date.parse(v.updatedAt)),
    )
  )
    return fail();
  if (
    !s.persons ||
    typeof s.persons !== "object" ||
    Array.isArray(s.persons) ||
    !Object.keys(s.persons).every(id) ||
    Object.entries(s.persons).some(
      ([key, p]) =>
        key !== p.id ||
        !str(p.name) ||
        p.name.trim().length < 1 ||
        p.name.length > 50,
    )
  )
    return fail();
  if (
    s.profile.avatarId &&
    (!s.media[s.profile.avatarId] ||
      s.media[s.profile.avatarId]?.kind !== "image")
  )
    return fail();
}
