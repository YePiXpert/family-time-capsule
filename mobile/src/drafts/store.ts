import type { SQLiteDatabase } from "expo-sqlite";
import { getDatabase } from "../storage/database";
import { parseDraftContent, emptyDraftContent, type DraftContent } from "./model";
import type { MediaCapturePayload } from "../types";
export type LocalDraft = {
  id: string; scope: string; content: DraftContent; revision: number; serverRevision: number;
  mutationId: string; status: "editing" | "queued" | "published" | "discarded";
  syncIntent?: "draft" | "review" | "publish";
  syncedRevision?: number;
  discardPending?: boolean;
  memoryEventId: string | null; updatedAt: string;
};
export async function listLocalDrafts(scope: string): Promise<LocalDraft[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ snapshot_json: string }>("SELECT snapshot_json FROM local_draft WHERE scope=? ORDER BY updated_at DESC", scope);
  return rows.map(row => JSON.parse(row.snapshot_json) as LocalDraft);
}
export async function createLocalDraft(scope: string, id: string, mutationId: string): Promise<LocalDraft> {
  const row: LocalDraft = { id, scope, content: emptyDraftContent(), revision: 1, serverRevision: 0, mutationId, status: "editing", memoryEventId: null, updatedAt: new Date().toISOString() };
  await saveLocalDraft(row, 0);
  return row;
}
export async function saveLocalDraft(row: LocalDraft, expectedRevision: number, original?: { id: string; payload: MediaCapturePayload }): Promise<void> {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(tx => saveLocalDraftInTransaction(tx, row, expectedRevision, original));
}
export async function saveLocalDraftInTransaction(tx: SQLiteDatabase, row: LocalDraft, expectedRevision: number, original?: { id: string; payload: MediaCapturePayload }): Promise<void> {
  parseDraftContent(row.content);

    const live = await tx.getFirstAsync<{ revision: number }>("SELECT revision FROM local_draft WHERE scope=? AND id=?", row.scope, row.id);
    if ((live?.revision ?? 0) !== expectedRevision) throw new Error("草稿已在另一处修改，请重新打开；本次输入尚未保存。");
    if (original) {
      if (!row.content.items.some(item => item.localCaptureRef === original.id)) throw new Error("原件缺少草稿引用。");
      const payload = original.payload;
      await tx.runAsync(`INSERT INTO local_capture(id,kind,title,occurred_at,local_uri,media_type,payload_json,sync_state)
        VALUES (?, 'media_capture', ?, ?, ?, ?, ?, 'pending')`, original.id, payload.fileName, row.updatedAt, payload.localUri, payload.mediaType, JSON.stringify(payload));
    }
    for (const item of row.content.items) {
      if (item.localCaptureRef && !await tx.getFirstAsync<{ id: string }>("SELECT id FROM local_capture WHERE id=?", item.localCaptureRef)) throw new Error("草稿引用的本机原件已经不可读；本次没有覆盖原草稿。");
    }
    // Pausing/discarding removes only this aggregate's unsent outbox references.
    // An original still queued by another draft retains its independent consent.
    if (row.status === "editing" || row.status === "discarded") {
      const others = await tx.getAllAsync<{ snapshot_json: string }>("SELECT snapshot_json FROM local_draft WHERE scope=? AND id<>?", row.scope, row.id);
      const needed = new Set(others.flatMap(other => { const d = JSON.parse(other.snapshot_json) as LocalDraft; return d.status === "queued" ? d.content.items.map(item => item.localCaptureRef) : []; }));
      for (const item of row.content.items) if (item.localCaptureRef && !needed.has(item.localCaptureRef)) await tx.runAsync(`DELETE FROM outbox WHERE id=? AND NOT EXISTS (
        SELECT 1 FROM local_import_item i JOIN local_intake_choice c ON c.session_id=i.import_session_id
        WHERE i.capture_id=outbox.id AND c.destination='library' AND c.scope=?)`, item.localCaptureRef, row.scope);
    }
    await tx.runAsync(`INSERT INTO local_draft(scope,id,snapshot_json,revision,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(scope,id) DO UPDATE SET snapshot_json=excluded.snapshot_json,revision=excluded.revision,updated_at=excluded.updated_at`, row.scope, row.id, JSON.stringify(row), row.revision, row.updatedAt);
}

export async function queueDraftOriginals(row: LocalDraft): Promise<void> {
  if (row.content.visibility !== "family" && row.content.items.some(item => !item.assetId)) throw new Error("私密/指定成员草稿的原件保留在本机，暂不进入家庭上传队列。");
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async tx => {
    for (const item of row.content.items) {
      if (item.assetId || !item.localCaptureRef) continue;
      const original = await tx.getFirstAsync<{ payload_json: string | null; inbox_item_id: string | null }>("SELECT payload_json,inbox_item_id FROM local_capture WHERE id=?", item.localCaptureRef);
      if (!original?.payload_json) throw new Error("草稿原件不可读，请检查本机存储。");
      if (original.inbox_item_id) continue;
      await tx.runAsync("INSERT OR IGNORE INTO outbox(id,kind,payload_json,created_at) VALUES(?,'media_capture',?,?)", item.localCaptureRef, original.payload_json, row.updatedAt);
    }
  });
}

/** A family-bound draft cannot send its originals to a different family/account. */
export async function canUploadDraftOriginal(captureId: string, activeScope: string): Promise<boolean> {
  const db = await getDatabase();
  const references = await db.getAllAsync<{ scope: string }>(`SELECT DISTINCT d.scope FROM local_draft d,
    json_each(json_extract(d.snapshot_json, '$.content.items')) i
    WHERE json_extract(i.value, '$.localCaptureRef') = ?`, captureId);
  if (references.some(row => row.scope !== activeScope)) return false;
  const receipt = await db.getFirstAsync<{ scope: string | null; destination: string | null }>(`SELECT c.scope,c.destination
    FROM local_import_item i LEFT JOIN local_intake_choice c ON c.session_id=i.import_session_id WHERE i.capture_id=?`, captureId);
  if (!receipt) return true;
  // Old unbound receipts and newly received shares never inherit "sync all".
  if (receipt.scope !== activeScope && !(receipt.scope === "local" && references.length > 0)) return false;
  return references.length > 0 || receipt.destination === "library";
}

/** The explicit destination choice moves only references; it never copies the originals. */
export async function bindLocalDraft(id: string, targetScope: string): Promise<LocalDraft> {
  if (targetScope === "local") throw new Error("请先选择家庭。");
  const db = await getDatabase();
  let bound: LocalDraft | null = null;
  await db.withExclusiveTransactionAsync(async tx => {
    const source = await tx.getFirstAsync<{ snapshot_json: string }>("SELECT snapshot_json FROM local_draft WHERE scope='local' AND id=?", id);
    if (!source) throw new Error("本机草稿不存在。");
    if (await tx.getFirstAsync("SELECT id FROM local_draft WHERE scope=? AND id=?", targetScope, id)) throw new Error("该家庭已有同一草稿，请先核对。");
    const row = JSON.parse(source.snapshot_json) as LocalDraft;
    bound = { ...row, scope: targetScope, status: "editing", revision: row.revision + 1, updatedAt: new Date().toISOString() };
    await tx.runAsync("UPDATE local_intake_choice SET scope=?,revision=revision+1 WHERE scope='local' AND draft_id=? AND destination='draft'", targetScope, id);
    await tx.runAsync("UPDATE local_draft SET scope=?,snapshot_json=?,revision=?,updated_at=? WHERE scope='local' AND id=?", targetScope, JSON.stringify(bound), bound.revision, bound.updatedAt, id);
  });
  return bound!;
}
