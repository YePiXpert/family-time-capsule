import { canonical, contentHashOf, hashOf, lineage } from "./hash";
import type { Library, LocalLetter, LocalRecord, Stored } from "./model";

export type HistoryEntry = {
  id: string;
  at: string;
  by: string;
  record?: Omit<LocalRecord, "history">;
  letter?: Omit<LocalLetter, "history">;
};
type Versioned = Stored<LocalRecord> | Stored<LocalLetter>;
export function versionEntry(entity: Versioned): HistoryEntry {
  const { history: _history, ancestors: _ancestors, ...raw } = entity;
  const snapshot = "revision" in raw ? { ...raw, revision: 1 } : raw;
  const at = entity.updatedAt;
  const by =
    entity.modifiedBy ||
    ("by" in entity ? entity.by : "from" in entity ? entity.from : "") ||
    "家人";
  return {
    id: hashOf([contentHashOf(snapshot), at, by]),
    at,
    by,
    ...("revision" in snapshot
      ? { record: snapshot as LocalRecord }
      : { letter: snapshot as LocalLetter }),
  };
}
/** Append-only union: concurrent edits and previously restored versions all survive. */
export function versionHistory(
  ...versions: (Versioned | undefined)[]
): HistoryEntry[] {
  const entries = new Map<string, HistoryEntry>();
  for (const version of versions) {
    if (!version) continue;
    for (const entry of version.history ?? [])
      entries.set(entry.id, entry as HistoryEntry);
    const entry = versionEntry(version);
    entries.set(entry.id, entry);
  }
  return [...entries.values()].sort(
    (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
  );
}
export function captureHistory(previous: Library, next: Library): void {
  for (const kind of ["records", "letters"] as const) {
    for (const [id, entity] of Object.entries(next[kind])) {
      const old = previous[kind][id];
      if (old === entity || ("sealed" in entity && !entity.sealed)) continue;
      const updated = {
        ...entity,
        modifiedBy:
          next.settings.by ||
          ("from" in entity ? entity.from : entity.by) ||
          "家人",
      };
      const history = versionHistory(
        old && (!("sealed" in old) || old.sealed) ? old : undefined,
        updated,
      );
      Object.assign(next[kind], { [id]: { ...updated, history } });
    }
  }
}
export function mergeHistory(next: Library, libraries: Library[]): void {
  for (const kind of ["records", "letters"] as const)
    for (const [id, entity] of Object.entries(next[kind])) {
      if ("sealed" in entity && !entity.sealed) continue;
      const candidates = libraries
        .map((s) => s[kind][id])
        .filter((v) => v && (!("sealed" in v) || v.sealed));
      if (!entity.history && !candidates.some((v) => v?.history)) continue;
      const history = versionHistory(entity, ...candidates);
      if (canonical(entity.history ?? []) !== canonical(history))
        Object.assign(next[kind], { [id]: { ...entity, history } });
    }
}
export function historyMedia(entity: Versioned): string[] {
  return (entity.history ?? []).flatMap((v) => [
    ...(v.record?.mediaIds ?? v.letter?.mediaIds ?? []),
  ]);
}
export function restoreRecordVersion(
  s: Library,
  id: string,
  versionId: string,
  at: string,
): void {
  const current = s.records[id];
  const old = current?.history?.find((v) => v.id === versionId)?.record;
  if (!current || !old) throw new Error("这份历史版本已不存在。");
  s.records[id] = {
    ...old,
    id,
    revision: current.revision + 1,
    updatedAt: at,
    ancestors: lineage(current),
    history: current.history,
    personIds: old.personIds?.filter((p) => !!s.persons[p]),
  };
}
