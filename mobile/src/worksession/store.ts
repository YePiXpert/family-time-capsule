import { randomUUID } from "expo-crypto";
import { getDatabase } from "../storage/database";
import { materialKey, type MaterialRef } from "../collections/local";
export type WorkTarget =
  | { mode: "create"; kind: "book" | "album" }
  | {
      mode: "append";
      kind: "localAlbum" | "collection" | "book";
      id: string;
      revision?: number;
      chapterId?: string;
    };
export type WorkSession = {
  id: string;
  scope: string;
  target: WorkTarget;
  selected: MaterialRef[];
  month: string;
  source: "localDraft" | "memory" | "collection";
  audience: "personal" | "family";
  template: "growth" | "photos";
  title: string;
  updatedAt: string;
  coverRefKey?: string | null;
  positions?: Record<string, { offset: number; pages: number }>;
  completedId?: string;
};
export async function createWorkSession(
  scope: string,
  target: WorkTarget,
  selected: MaterialRef[] = [],
): Promise<WorkSession> {
  const row: WorkSession = {
    id: randomUUID(),
    scope,
    target,
    selected: [
      ...new Map(selected.map((ref) => [materialKey(ref), ref])).values(),
    ],
    month: "",
    source: scope === "local" ? "localDraft" : "memory",
    audience: "personal",
    template: "growth",
    title: "",
    updatedAt: new Date().toISOString(),
  };
  await saveWorkSession(row);
  return row;
}
export async function getWorkSession(
  scope: string,
  id: string,
): Promise<WorkSession | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ snapshot_json: string }>(
    "SELECT snapshot_json FROM local_work_session WHERE scope=? AND id=?",
    scope,
    id,
  );
  return row ? (JSON.parse(row.snapshot_json) as WorkSession) : null;
}
export async function listWorkSessions(scope: string): Promise<WorkSession[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ snapshot_json: string }>(
    "SELECT snapshot_json FROM local_work_session WHERE scope=? ORDER BY updated_at DESC",
    scope,
  );
  return rows
    .map((r) => JSON.parse(r.snapshot_json) as WorkSession)
    .filter(
      (r) =>
        !r.completedId && r.selected.length > 0 && r.target.mode === "create",
    );
}
export async function saveWorkSession(row: WorkSession) {
  if (
    row.selected.length > 100 ||
    row.selected.some(
      (r) =>
        r.scope !== row.scope &&
        !(r.kind === "localDraft" && r.scope === "local"),
    )
  )
    throw new Error("请选择当前家庭的内容，每次最多 100 条。");
  const db = await getDatabase();
  await db.runAsync(
    "INSERT INTO local_work_session(scope,id,snapshot_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at",
    row.scope,
    row.id,
    JSON.stringify(row),
    row.updatedAt,
  );
}
export function toggleWorkSelection(
  row: WorkSession,
  ref: MaterialRef,
): WorkSession {
  const key = materialKey(ref),
    exists = row.selected.some((r) => materialKey(r) === key);
  if (!exists && row.selected.length >= 100)
    throw new Error("每次最多选择 100 条，当前选择已保留。");
  return {
    ...row,
    selected: exists
      ? row.selected.filter((r) => materialKey(r) !== key)
      : [...row.selected, ref],
    updatedAt: new Date().toISOString(),
  };
}
