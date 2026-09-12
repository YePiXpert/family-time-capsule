import { getDatabase } from "../storage/database";
import type { ImportPhotoGroup, ImportPhotoSelection } from "./photo-selection";

let writes: Promise<unknown> = Promise.resolve();
export async function drainPhotoSelectionWrites(): Promise<void> { await writes.catch(() => {}); }

export class PhotoSelectionConflictError extends Error {
  readonly code = "photo_selection_conflict";
  constructor(readonly currentRevision: number) {
    super("这次挑选已在另一处修改，请重新打开后核对。本次选择尚未保存。");
    this.name = "PhotoSelectionConflictError";
  }
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function stringIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonemptyString) && new Set(value).size === value.length;
}

/** Copy at the call boundary so later UI mutations cannot alter an enqueued save. */
function selectionSnapshot(value: unknown): ImportPhotoSelection {
  if (!value || typeof value !== "object") throw new Error("本机挑选记录格式无效，请重新打开后核对。");
  const row = value as Partial<ImportPhotoSelection>;
  if (!stringIds(row.selectedIds) || !(row.coverId === null || nonemptyString(row.coverId)) ||
      !Array.isArray(row.groups) || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0 ||
      typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt))) {
    throw new Error("本机挑选记录格式无效，请重新打开后核对。");
  }
  const groupIds = new Set<string>();
  const itemIds = new Set<string>();
  const groups: ImportPhotoGroup[] = [];
  for (const group of row.groups) {
    if (!group || !nonemptyString(group.id) || groupIds.has(group.id) || !stringIds(group.ids) || !group.ids.length ||
        !nonemptyString(group.representativeId) || !group.ids.includes(group.representativeId) ||
        !["time", "batch", "manual"].includes(group.reason) || group.ids.some(id => itemIds.has(id))) {
      throw new Error("本机挑选分组格式无效，请重新打开后核对。");
    }
    groupIds.add(group.id);
    group.ids.forEach(id => itemIds.add(id));
    groups.push({ id: group.id, ids: [...group.ids], representativeId: group.representativeId, reason: group.reason });
  }
  if (row.selectedIds.some(id => !itemIds.has(id)) || row.coverId !== null && !row.selectedIds.includes(row.coverId)) {
    throw new Error("挑选内容与封面不一致，请重新打开后核对。");
  }
  return { selectedIds: [...row.selectedIds], coverId: row.coverId, groups, revision: row.revision!, updatedAt: row.updatedAt };
}

function validateKey(scope: string, sessionId: string) {
  if (!nonemptyString(scope) || !nonemptyString(sessionId)) throw new Error("请先打开当前账号的一次导入，再保存挑选。");
}

export async function loadPhotoSelection(scope: string, sessionId: string): Promise<ImportPhotoSelection | null> {
  validateKey(scope, sessionId);
  await writes.catch(() => {});
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ snapshot_json: string; revision: number; updated_at: string }>(
    "SELECT snapshot_json,revision,updated_at FROM local_import_selection WHERE scope=? AND session_id=?", scope, sessionId);
  if (!row) return null;
  let value: unknown;
  try { value = JSON.parse(row.snapshot_json); }
  catch { throw new Error("本机挑选记录暂时无法读取，请重新打开后核对。"); }
  const snapshot = selectionSnapshot(value);
  if (snapshot.revision !== row.revision || snapshot.updatedAt !== row.updated_at) {
    throw new Error("本机挑选记录的保存版本不一致，请重新打开后核对。");
  }
  return snapshot;
}

export function savePhotoSelection(scope: string, sessionId: string, selection: ImportPhotoSelection,
  expectedRevision: number): Promise<ImportPhotoSelection> {
  let snapshot: ImportPhotoSelection;
  try {
    validateKey(scope, sessionId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) {
      throw new Error("挑选记录的保存版本无效，请重新打开后核对。");
    }
    snapshot = selectionSnapshot(selection);
    if (snapshot.revision !== expectedRevision) throw new Error("挑选记录的保存版本已变化，请重新打开后核对。");
  } catch (error) {
    return Promise.reject(error);
  }
  const operation = writes.catch(() => {}).then(async () => {
    const db = await getDatabase();
    const saved: ImportPhotoSelection = { ...snapshot, revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
    await db.withExclusiveTransactionAsync(async tx => {
      const current = await tx.getFirstAsync<{ revision: number }>(
        "SELECT revision FROM local_import_selection WHERE scope=? AND session_id=?", scope, sessionId);
      const revision = current?.revision ?? 0;
      if (revision !== expectedRevision) throw new PhotoSelectionConflictError(revision);
      if (current) {
        const result = await tx.runAsync(`UPDATE local_import_selection SET snapshot_json=?,revision=?,updated_at=?
          WHERE scope=? AND session_id=? AND revision=?`,
        JSON.stringify(saved), saved.revision, saved.updatedAt, scope, sessionId, expectedRevision);
        if (result.changes !== 1) throw new PhotoSelectionConflictError(revision);
      } else {
        await tx.runAsync(`INSERT INTO local_import_selection(scope,session_id,snapshot_json,revision,updated_at)
          VALUES(?,?,?,?,?)`, scope, sessionId, JSON.stringify(saved), saved.revision, saved.updatedAt);
      }
    });
    return saved;
  });
  writes = operation;
  return operation;
}
