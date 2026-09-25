import { lineage } from "./hash";
import { randomUUID } from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { DOCS_DIR, LEGACY_DOCS_DIR } from "./brand";
import {
  consumePendingNativeShares,
  acknowledgeNativeShare,
  type NativeShareItem,
  type NativeShareManifest,
} from "../../modules/share-intake/src";
import {
  appendToAlbum,
  clone,
  deleteAlbum as removeAlbum,
  deleteLetter as removeLetter,
  editEntity,
  emptyContent,
  LETTER_FROM_LIMIT,
  newAlbumFrom,
  referencedMedia,
  type Library,
  type MediaKind,
  type LocalLetter,
  type LocalMedia,
  type LocalRecord,
  type Mutable,
  type PhotoMetadata,
  type RecordDraft,
  type Stored,
} from "./model";
import { deleteMediaFiles, preserveMedia } from "./files";
import { defaultOpenAt, openLetterAt, sealLetterAt } from "./letters";
import { applyPhotoMetadata } from "./photo-metadata";
import type { LocalStore } from "./store";
export const newId = () => randomUUID();
export const now = () => new Date().toISOString();
export async function beginDraft(
  store: LocalStore,
  recordId: string | null = null,
) {
  return store.change((s) => {
    const existing = recordId
      ? Object.values(s.drafts).find((d) => d.recordId === recordId)
      : null;
    if (existing) return existing.id;
    const record = recordId ? s.records[recordId] : null;
    if (recordId && !record) throw new Error("记录已删除。");
    const id = newId();
    s.drafts[id] = {
      id,
      recordId,
      baseRevision: record?.revision ?? 0,
      autoDate: !record,
      autoLocation: !record,
      content: record
        ? (clone(record) as Mutable<Stored<LocalRecord>>)
        : emptyContent(s.settings.by),
      updatedAt: now(),
    };
    return id;
  });
}
export function updateDraft(s: Library, draft: RecordDraft) {
  if (!s.drafts[draft.id]) throw new Error("草稿已关闭，请重新打开。");
  s.drafts[draft.id] = clone(draft);
}
export async function beginSelection(
  store: LocalStore,
  albumId: string | null = null,
  selected: string[] = [],
) {
  return store.change((s) => {
    if (albumId && !s.albums[albumId]) throw new Error("相册已删除。");
    const previous = Object.values(s.selections).find(
      (q) => q.albumId === albumId,
    );
    if (previous) {
      editEntity(s, "selections", previous.id, (q) => {
        q.selected = [...new Set([...q.selected, ...selected])];
      });
      return previous.id;
    }
    const id = newId();
    s.selections[id] = {
      id,
      albumId,
      selected,
      month: "",
      offset: 0,
      name: "",
      coverId: null,
    };
    return id;
  });
}
/** 把几条记录直接收进已有相册（阅读页「加入相册」）；返回相册。 */
export async function addRecordsToAlbum(
  store: LocalStore,
  albumId: string,
  recordIds: readonly string[],
) {
  return store.change((s) =>
    appendToAlbum(s, albumId, recordIds, newId, now()),
  );
}
/** 用这几条记录直接建一本相册；返回相册 id。 */
export async function createAlbumWithRecords(
  store: LocalStore,
  recordIds: readonly string[],
  name = "",
) {
  return store.change(
    (s) => newAlbumFrom(s, newId(), recordIds, newId, now(), name).id,
  );
}
/** keep：库外还有人要的素材（两台手机都改过时留底的那一版），不算没用到。 */
export async function collectUnusedMedia(
  store: LocalStore,
  keep: ReadonlySet<string> = new Set(),
) {
  const removed = await store.change((s) => {
    const refs = referencedMedia(s);
    const unused = Object.values(s.media).filter(
      (m) => !refs.has(m.id) && !keep.has(m.id),
    );
    for (const m of unused) delete s.media[m.id];
    return unused;
  });
  for (const m of removed) deleteMediaFiles(m);
  return removed.reduce((n, m) => n + m.bytes, 0);
}
/** 新建一封没封存的信；拆封日默认 18 岁生日（没填生日则今天起 18 年）。 */
export async function beginLetter(store: LocalStore, from = "") {
  return store.change((s) => {
    const id = newId(),
      at = now();
    s.letters[id] = {
      id,
      title: "",
      text: "",
      from: from.trim().slice(0, LETTER_FROM_LIMIT),
      openAt: defaultOpenAt(s.profile.birthday),
      writtenAt: at,
      sealed: false,
      mediaIds: [],
      coverId: null,
      updatedAt: at,
    };
    return id;
  });
}
/** 草稿信整体替换；封存后的信不能再改。 */
export function updateLetter(s: Library, letter: Stored<LocalLetter>) {
  const existing = s.letters[letter.id];
  if (!existing) throw new Error("这封信已删除。");
  if (existing.sealed) throw new Error("信已封存，不能再改。");
  s.letters[letter.id] = { ...clone(letter), ancestors: lineage(existing) };
}
export async function sealLetter(store: LocalStore, id: string) {
  await store.change((s) => {
    const letter = s.letters[id];
    if (!letter) throw new Error("这封信已删除。");
    s.letters[id] = { ...sealLetterAt(letter, now()), ancestors: lineage(letter) };
  });
}
export async function openLetter(store: LocalStore, id: string) {
  await store.change((s) => {
    const letter = s.letters[id];
    if (!letter) throw new Error("这封信已删除。");
    const opened = openLetterAt(letter, now());
    if (opened !== letter)
      s.letters[id] = { ...opened, ancestors: lineage(letter) };
  });
}
/** 删信只删实体（留墓碑）；信里的录音和记录一样，留给「清理未使用素材」回收。 */
export async function deleteLetter(store: LocalStore, id: string) {
  await store.change((s) => {
    removeLetter(s, id, now());
  });
}
/** 删相册：记录保留、选材会话关掉、留墓碑。 */
export async function deleteAlbum(store: LocalStore, id: string) {
  await store.change((s) => {
    removeAlbum(s, id, now());
  });
}
/** 改人物名；trim 后 1-50 字，同名复用规则不适用于改名（保留身份）。 */
export async function renamePerson(
  store: LocalStore,
  id: string,
  name: string,
) {
  await store.change((s) => {
    const person = s.persons[id];
    if (!person) throw new Error("没有这个人。");
    const trimmed = name.trim().slice(0, 50);
    if (!trimmed) throw new Error("名字不能是空的。");
    editEntity(s, "persons", id, (p) => {
      p.name = trimmed;
    });
  });
}
/** 新建人物（同名复用既有 id），供编辑器人物 chips 调用。 */
export async function createPerson(store: LocalStore, name: string) {
  return store.change((s) => {
    const trimmed = name.trim().slice(0, 50);
    if (!trimmed) throw new Error("先写上名字。");
    const existing = Object.values(s.persons).find((p) => p.name === trimmed);
    if (existing) return existing.id;
    const id = newId();
    s.persons[id] = { id, name: trimmed };
    return id;
  });
}
/** Native capture fields are optional and untrusted; keep only what validateLibrary would accept. */
function shareItemPhotoMetadata(
  item: NativeShareItem,
): PhotoMetadata | undefined {
  const result: PhotoMetadata = {};
  if (
    typeof item.capturedAt === "string" &&
    Number.isFinite(Date.parse(item.capturedAt))
  )
    result.capturedAt = item.capturedAt;
  if (
    typeof item.latitude === "number" &&
    typeof item.longitude === "number" &&
    Number.isFinite(item.latitude) &&
    Number.isFinite(item.longitude) &&
    Math.abs(item.latitude) <= 90 &&
    Math.abs(item.longitude) <= 180
  ) {
    result.latitude = item.latitude;
    result.longitude = item.longitude;
  }
  return Object.keys(result).length ? result : undefined;
}

/** Handles one manifest; returns how many of its items were skipped as unusable. */
async function receiveOneShare(
  store: LocalStore,
  manifest: NativeShareManifest,
): Promise<number> {
  const documents = Paths.document.uri.replace(/\/$/, "");
  const base = `${documents}/${DOCS_DIR}/intake/originals/`;
  // 改名前排队的清单里记的还是旧目录的绝对路径；文件本身已随目录搬过去了。
  const legacyBase = `${documents}/${LEGACY_DOCS_DIR}/intake/originals/`;
  const media: LocalMedia[] = [];
  const originals: string[] = [];
  const text: string[] = [];
  let skipped = 0;
  for (const item of manifest.items) {
    if (item.kind === "text" && item.text) {
      text.push(item.text);
      continue;
    }
    if (item.kind !== "file" || !item.localUri || !item.fileName) {
      skipped++;
      continue;
    }
    const localUri = item.localUri.startsWith(legacyBase)
      ? base + item.localUri.slice(legacyBase.length)
      : item.localUri;
    if (
      !localUri.startsWith(base) ||
      localUri.slice(base.length).includes("/") ||
      localUri.includes("..")
    ) {
      skipped++;
      continue;
    }
    const kind: MediaKind =
      item.mediaType ??
      (item.mimeType?.startsWith("image/")
        ? "image"
        : item.mimeType?.startsWith("video/")
          ? "video"
          : item.mimeType?.startsWith("audio/")
            ? "audio"
            : "document");
    try {
      const preserved = await preserveMedia(localUri, item.fileName, kind);
      const photo = shareItemPhotoMetadata(item);
      if (photo) preserved.photoMetadata = photo;
      media.push(preserved);
      originals.push(localUri);
    } catch (e) {
      // 空间不够是暂时的：整批不确认，腾出空间后下次启动重来；别的错才算这一项坏了。
      if (outOfSpace(e)) {
        for (const m of media) deleteMediaFiles(m);
        throw new Error("本机空间不足，分享的内容还留着，清理一些空间后再打开应用。");
      }
      skipped++;
    }
  }
  if (!text.length && !media.length) {
    // 无可保存内容时不建空草稿；确认接收以免这条任务每次启动都重放。
    await acknowledgeNativeShare(manifest.manifestId);
    return Math.max(skipped, 1);
  }
  let duplicate = false;
  try {
    await store.change((s) => {
      if (s.receivedShares.includes(manifest.manifestId)) {
        duplicate = true;
        return;
      }
      const id = newId();
      const content = emptyContent();
      content.text = text.join("\n");
      content.mediaIds = media.map((m) => m.id);
      content.coverId = media.find((m) => m.kind === "image")?.id ?? null;
      for (const m of media) s.media[m.id] = m;
      // 与编辑器导入一致：按拍摄信息自动落日期地点；跨多天的照片仍保存在一份草稿。
      const draft: RecordDraft = {
        id,
        recordId: null,
        baseRevision: 0,
        autoDate: true,
        autoLocation: true,
        content,
        updatedAt: now(),
      };
      s.drafts[id] = media.reduce(
        (next, item) => applyPhotoMetadata(next, item.photoMetadata),
        draft,
      );
      s.receivedShares.push(manifest.manifestId);
    });
  } catch (e) {
    // 库写入失败时收回已复制的文件（含缩略图），避免重试时静默膨胀。
    for (const m of media) deleteMediaFiles(m);
    throw e;
  }
  // 另一轮接收已经收下了这一份：这一轮复制出来的文件没人引用。
  if (duplicate) for (const m of media) deleteMediaFiles(m);
  await acknowledgeNativeShare(manifest.manifestId);
  // 已复制进 media 并确认：收件箱里的原件没人再要。
  for (const uri of originals)
    try {
      const f = new File(uri);
      if (f.exists) f.delete();
    } catch {
      // 多占一份空间，不影响已保存的草稿。
    }
  return skipped;
}
const outOfSpace = (e: unknown) =>
  (!!e && typeof e === "object" && (e as { code?: unknown }).code === "ENOSPC") ||
  /ENOSPC|no space left|空间不足/i.test(e instanceof Error ? e.message : String(e));
export async function receiveShares(store: LocalStore): Promise<void> {
  const failed: string[] = [];
  let skipped = 0;
  for (const manifest of await consumePendingNativeShares()) {
    if (
      !manifest.complete ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(manifest.manifestId)
    )
      continue;
    if (store.get().receivedShares.includes(manifest.manifestId)) {
      await acknowledgeNativeShare(manifest.manifestId);
      continue;
    }
    try {
      skipped += await receiveOneShare(store, manifest);
    } catch (e) {
      failed.push(
        `一份分享未能保存：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  // 单批失败不影响其余批次；有批未确认时会保留原生任务，下次启动重试。
  if (failed.length)
    throw new Error(
      [
        ...failed,
        "原接收任务已保留，请重试。",
        ...(skipped
          ? [`另有 ${skipped} 份分享素材未能保存，其余已存为草稿。`]
          : []),
      ].join("\n"),
    );
  if (skipped)
    throw new Error(
      `有 ${skipped} 份分享素材未能保存，其余已存为草稿。这些素材已确认接收，不会重复导入。`,
    );
}
