import {
  type LocalLetter,
  type LocalRecord,
  type RecordContent,
  type RecordDraft,
  type Stored,
} from "./model";

/**
 * 「点开就建」的实体退出时要不要静默清理：什么都没填的草稿、信不该留在书架上，
 * 也不该三天后被催。判定只看内容，不看日期、开关这类附带状态。
 */

/** 草稿：没有标题、正文、地点、人物、附件，也没有进行中的录音。 */
export function isEmptyDraft(d: Stored<RecordDraft> | RecordDraft): boolean {
  const c = d.content;
  return (
    !c.title.trim() &&
    !c.text.trim() &&
    !c.location.trim() &&
    !c.personIds?.length &&
    c.mediaIds.length === 0 &&
    !d.recordingFile
  );
}

const CONTENT_KEYS = [
  "title",
  "text",
  "date",
  "location",
  "first",
  "quote",
  "by",
  "coverId",
  "mediaIds",
  "personIds",
] as const satisfies readonly (keyof RecordContent)[];
/**
 * 编辑已有记录的草稿：打开时整条复制，永远不「空」。什么都没改就走也该静默清理，
 * 否则书架挂着「上次没写完」，原记录之后一改，这份草稿就再也存不进去。
 */
export function isUntouchedEdit(
  d: Stored<RecordDraft> | RecordDraft,
  record: Stored<LocalRecord> | LocalRecord | undefined,
): boolean {
  if (!d.recordId || !record || d.recordingFile || d.aiJob || d.aiProposal)
    return false;
  const c = d.content as RecordContent;
  const r = record as RecordContent;
  // 旧记录可能缺 quote／personIds／by：缺省与空值一视同仁。
  const norm = (v: unknown) =>
    JSON.stringify(Array.isArray(v) && !v.length ? null : v || null);
  return CONTENT_KEYS.every((k) => norm(c[k]) === norm(r[k]));
}

/** 信：还没封存，且没有标题、正文、录音（落款与拆封日不算内容）。 */
export function isEmptyLetter(l: Stored<LocalLetter> | LocalLetter): boolean {
  return (
    !l.sealed && !l.title.trim() && !l.text.trim() && l.mediaIds.length === 0
  );
}
