import { lineage } from "../local/hash";
import type { Library, LocalLetter, LocalRecord } from "../local/model";
import { repairReferences } from "./merge";
import type { Conflict } from "./state";

/** 留底版本用到的素材：只登记在 conflicts.json 里，本机「清理没用到的」不能把它们当垃圾删掉。 */
export function conflictMediaIds(conflicts: readonly Conflict[]): Set<string> {
  const ids = new Set<string>();
  for (const c of conflicts) {
    const loser = c.loser as { mediaIds?: unknown; avatarId?: unknown } | undefined;
    if (Array.isArray(loser?.mediaIds))
      for (const id of loser.mediaIds) if (typeof id === "string") ids.add(id);
    if (typeof loser?.avatarId === "string") ids.add(loser.avatarId);
  }
  return ids;
}

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
      ...(lib.records[id]
        ? { ancestors: lineage(lib.records[id]) }
        : loser.ancestors ? { ancestors: [...loser.ancestors] } : {}),
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
      ...(lib.letters[id]
        ? { ancestors: lineage(lib.letters[id]) }
        : loser.ancestors ? { ancestors: [...loser.ancestors] } : {}),
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
