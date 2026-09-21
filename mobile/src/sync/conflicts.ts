import type { Library, LocalLetter, LocalRecord } from "../local/model";
import { repairReferences } from "./merge";
import type { Conflict } from "./state";

/** 留底作为刚写的新一版：实体与根字段都整个替换，不触碰冻结的旧值。 */
export function restoreLoser(lib: Library, c: Conflict, now: string): void {
  const id = c.entityId;
  if (c.kind === "records") {
    const loser = c.loser as LocalRecord;
    const mediaIds = loser.mediaIds.filter((id) => lib.media[id]);
    lib.records[id] = {
      id,
      title: loser.title,
      text: loser.text,
      date: loser.date,
      location: loser.location,
      first: loser.first,
      mediaIds,
      coverId: loser.coverId && mediaIds.includes(loser.coverId) ? loser.coverId : null,
      ...(loser.personIds ? { personIds: loser.personIds.filter((id) => lib.persons[id]) } : {}),
      ...(loser.quote !== undefined ? { quote: loser.quote } : {}),
      ...(loser.by !== undefined ? { by: loser.by } : {}),
      revision: (lib.records[id]?.revision ?? 0) + 1,
      updatedAt: now,
    };
  } else if (c.kind === "letters") {
    const loser = c.loser as LocalLetter;
    const mediaIds = loser.mediaIds.filter((id) => lib.media[id]);
    lib.letters[id] = {
      id,
      title: loser.title,
      text: loser.text,
      from: loser.from,
      openAt: loser.openAt,
      writtenAt: loser.writtenAt,
      sealed: loser.sealed,
      ...(loser.openedAt !== undefined ? { openedAt: loser.openedAt } : {}),
      mediaIds,
      coverId: loser.coverId && mediaIds.includes(loser.coverId) ? loser.coverId : null,
      updatedAt: now,
    };
  } else {
    throw new Error("不认识的冲突。");
  }
  lib.tombstones = Object.fromEntries(
    Object.entries(lib.tombstones ?? {}).filter(([key]) => key !== `${c.kind}:${id}`),
  );
  repairReferences(lib);
}
