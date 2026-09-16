/** Device-owned data. No account identity or transport state belongs here. */
export type MediaKind = "image" | "video" | "audio" | "document";
export type LocalMedia = {
  id: string;
  file: string;
  name: string;
  kind: MediaKind;
  bytes: number;
  sha256: string;
};
export type RecordContent = {
  title: string;
  text: string;
  date: string;
  location: string;
  first: boolean;
  mediaIds: string[];
  coverId: string | null;
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
};
export type LocalAlbum = {
  id: string;
  name: string;
  items: { id: string; recordId: string }[];
  coverId: string | null;
  updatedAt: string;
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
  settings: { theme: "auto" | "light" | "dark"; largeText: boolean };
  records: Record<string, LocalRecord>;
  drafts: Record<string, RecordDraft>;
  media: Record<string, LocalMedia>;
  albums: Record<string, LocalAlbum>;
  selections: Record<string, SelectionSession>;
  receivedShares: string[];
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
  receivedShares: [],
});
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
export function sortedRecords(s: Library): LocalRecord[] {
  return Object.values(s.records).sort(
    (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
  );
}
export function referencedMedia(s: Library): Set<string> {
  return new Set([
    ...(s.profile.avatarId ? [s.profile.avatarId] : []),
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
    !ids(s.receivedShares)
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
      !/^[a-f0-9]{64}$/.test(m.sha256)
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
    (c.coverId === null || c.mediaIds.includes(c.coverId));
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
    s.profile.avatarId &&
    (!s.media[s.profile.avatarId] ||
      s.media[s.profile.avatarId]?.kind !== "image")
  )
    return fail();
}
