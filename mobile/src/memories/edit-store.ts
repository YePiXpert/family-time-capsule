import { getDatabase } from "../storage/database";
import type { DraftOriginal } from "../drafts/store";
import type { LocalMemoryEdit } from "./edit-model";

const listeners = new Set<() => void>();
let version = 0;
let writes: Promise<unknown> = Promise.resolve();
export const subscribeMemoryEdits = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const memoryEditsVersion = () => version;
function notify() { version += 1; for (const listener of listeners) listener(); }

export async function getMemoryEdit(scope: string, memoryId: string): Promise<LocalMemoryEdit | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ snapshot_json: string }>(
    "SELECT snapshot_json FROM local_memory_edit WHERE scope=? AND memory_id=?", scope, memoryId);
  return row ? JSON.parse(row.snapshot_json) as LocalMemoryEdit : null;
}
export async function listMemoryEdits(scope: string): Promise<LocalMemoryEdit[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ snapshot_json: string }>(
    "SELECT snapshot_json FROM local_memory_edit WHERE scope=? ORDER BY updated_at,memory_id", scope);
  return rows.map(row => JSON.parse(row.snapshot_json) as LocalMemoryEdit);
}

/** Serialize typing, explicit saves and network receipts against the latest row. */
export function changeMemoryEdit(scope: string, memoryId: string,
  change: (current: LocalMemoryEdit | null) => LocalMemoryEdit | null, originals: DraftOriginal[] = []): Promise<LocalMemoryEdit | null> {
  const operation = writes.catch(() => {}).then(async () => {
    const db = await getDatabase();
    let result: LocalMemoryEdit | null = null;
    await db.withExclusiveTransactionAsync(async tx => {
      const row = await tx.getFirstAsync<{ snapshot_json: string }>(
        "SELECT snapshot_json FROM local_memory_edit WHERE scope=? AND memory_id=?", scope, memoryId);
      const current = row ? JSON.parse(row.snapshot_json) as LocalMemoryEdit : null;
      const next = change(current);
      result = next ? { ...next, scope, memoryId, revision: (current?.revision ?? 0) + 1, updatedAt: new Date().toISOString() } : null;
      if (result) {
        for (const original of originals) {
          if (!result.content.items?.some(item => item.localCaptureRef === original.id)) throw new Error("原件缺少记录引用。");
          const payload = { ...original.payload, memoryEditOwnerScope: scope, memoryEditTarget: memoryId };
          await tx.runAsync(`INSERT INTO local_capture(id,kind,title,occurred_at,local_uri,media_type,payload_json,sync_state)
            VALUES (?, 'media_capture', ?, ?, ?, ?, ?, 'pending')`, original.id, payload.fileName, result.updatedAt, payload.localUri, payload.mediaType, JSON.stringify(payload));
        }
        for (const item of result.content.items ?? []) {
          if (item.localCaptureRef && !await tx.getFirstAsync("SELECT id FROM local_capture WHERE id=?", item.localCaptureRef)) throw new Error("本机原件已不可读，请重新添加后保存。");
          if (item.localCaptureRef) await tx.runAsync("DELETE FROM outbox WHERE id=?", item.localCaptureRef);
        }
        await tx.runAsync(`INSERT INTO local_memory_edit(scope,memory_id,snapshot_json,updated_at) VALUES(?,?,?,?)
          ON CONFLICT(scope,memory_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at`,
        scope, memoryId, JSON.stringify(result), result.updatedAt);
      } else await tx.runAsync("DELETE FROM local_memory_edit WHERE scope=? AND memory_id=?", scope, memoryId);
    });
    notify();
    return result;
  });
  writes = operation;
  return operation;
}

export async function drainMemoryEditWrites(): Promise<void> { await writes.catch(() => {}); }
