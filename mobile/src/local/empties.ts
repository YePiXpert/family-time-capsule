import {
  type LocalLetter,
  type RecordDraft,
  type Stored,
} from "./model";

/**
 * 「点开就建」的实体退出时要不要静默清理：什么都没填的草稿、信不该留在书架上，
 * 也不该三天后被催。判定只看内容，不看日期、开关这类附带状态。
 */

/** 草稿：没有标题、正文、地点、人物、附件，也没有进行中的录音；分成几件事时每件事也都空。 */
export function isEmptyDraft(d: Stored<RecordDraft> | RecordDraft): boolean {
  const c = d.content;
  return (
    !c.title.trim() &&
    !c.text.trim() &&
    !c.location.trim() &&
    !c.personIds?.length &&
    c.mediaIds.length === 0 &&
    !d.recordingFile &&
    !d.photoEvents?.some(
      (event) =>
        event.mediaIds.length > 0 || event.title.trim() || event.text.trim(),
    )
  );
}

/** 信：还没封存，且没有标题、正文、录音（落款与拆封日不算内容）。 */
export function isEmptyLetter(l: Stored<LocalLetter> | LocalLetter): boolean {
  return (
    !l.sealed && !l.title.trim() && !l.text.trim() && l.mediaIds.length === 0
  );
}
