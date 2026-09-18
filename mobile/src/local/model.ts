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
  records: Record<string, LocalRecord>;
  drafts: Record<string, RecordDraft>;
  media: Record<string, LocalMedia>;
  albums: Record<string, LocalAlbum>;
  selections: Record<string, SelectionSession>;
  /** 同款时光对比系列；旧库无此字段。 */
  series: Record<string, LocalSeries>;
  /** 记录里出现的人物；旧库无此字段。 */
  persons: Record<string, LocalPerson>;
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
export function recordTitle(r: RecordContent): string {
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
export function sortedRecords(s: Library): LocalRecord[] {
  return Object.values(s.records).sort(
    (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
  );
}
export function recordsOfPerson(
  records: LocalRecord[],
  personId: string,
): LocalRecord[] {
  return records.filter((r) => r.personIds?.includes(personId));
}

function stripPerson(
  contents: RecordContent[],
  personId: string,
  retag: (ids: string[]) => string[],
): void {
  for (const c of contents) {
    if (!c.personIds?.includes(personId)) continue;
    const next = retag(c.personIds);
    if (next.length) c.personIds = next;
    else delete c.personIds;
  }
}

/** 删除人物并从全部记录/草稿标记里剥离；只取消标记，不动记录。 */
export function deletePerson(s: Library, id: string): void {
  if (!s.persons[id]) throw new Error("没有这个人。");
  delete s.persons[id];
  const strip = (ids: string[]) => ids.filter((p) => p !== id);
  const all = [
    ...Object.values(s.records),
    ...Object.values(s.drafts).map((d) => d.content),
    ...(Object.values(s.drafts).flatMap((d) => d.photoEvents ?? []) as RecordContent[]),
  ];
  stripPerson(all, id, strip);
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
  const retag = (ids: string[]) => [
    ...new Set(ids.map((p) => (p === sourceId ? targetId : p))),
  ];
  const all = [
    ...Object.values(s.records),
    ...Object.values(s.drafts).map((d) => d.content),
    ...(Object.values(s.drafts).flatMap((d) => d.photoEvents ?? []) as RecordContent[]),
  ];
  stripPerson(all, sourceId, retag);
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
  for (const album of Object.values(s.albums)) {
    album.items = album.items.filter((i) => i.recordId !== id);
  }
  for (const selection of Object.values(s.selections))
    selection.selected = selection.selected.filter((x) => x !== id);
  for (const series of Object.values(s.series))
    series.items = series.items.filter((i) => i.recordId !== id);
  clearUnavailableCovers(s);
}
function clearUnavailableCovers(s: Library): void {
  for (const album of Object.values(s.albums))
    if (
      album.coverId &&
      !album.items.some((i) =>
        s.records[i.recordId]?.mediaIds.includes(album.coverId!),
      )
    )
      album.coverId = null;
  for (const selection of Object.values(s.selections))
    if (
      selection.coverId &&
      !selection.selected.some((id) =>
        s.records[id]?.mediaIds.includes(selection.coverId!),
      )
    )
      selection.coverId = null;
  // 配乐素材在 referencedMedia 里受保护；这里兜住外部写坏的悬空 id。
  if (
    s.settings.replayAudioId &&
    s.media[s.settings.replayAudioId]?.kind !== "audio"
  )
    delete s.settings.replayAudioId;
  // 记录编辑删掉某张照片时，系列里指向它的条目一并退场。
  for (const series of Object.values(s.series))
    series.items = series.items.filter((i) =>
      s.records[i.recordId]?.mediaIds.includes(i.mediaId),
    );
}
export function finishSelection(
  s: Library,
  sessionId: string,
  albumId: string,
  itemId: () => string,
  now: string,
): LocalAlbum {
  const session = s.selections[sessionId];
  if (!session) throw new Error("未找到选材内容。");
  if (!session.selected.length) throw new Error("请先选择记录。");
  const album = session.albumId
    ? s.albums[session.albumId]
    : {
        id: albumId,
        name: session.name.trim() || "新相册",
        items: [],
        coverId: session.coverId,
        updatedAt: now,
      };
  if (!album) throw new Error("相册已删除。");
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
  const content = (c: RecordContent) =>
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
              (event.coverId !== null && !id(event.coverId)),
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
