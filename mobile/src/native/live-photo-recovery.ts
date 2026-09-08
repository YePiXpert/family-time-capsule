import * as Crypto from "expo-crypto";
import { getDatabase } from "../storage/database";
import { emptyDraftContent } from "../drafts/model";
import { saveLocalDraftInTransaction, type LocalDraft } from "../drafts/store";
import type { LivePhotoPickerReceipt } from "./picker-receipt";

/** Recover only into the recorded account scope, with no upload or publication consent. */
export async function recoverLivePhotoDraft(receipt: LivePhotoPickerReceipt, exists: (uri: string) => boolean): Promise<void> {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async tx => {
    const rows = await tx.getAllAsync<{ snapshot_json: string }>("SELECT snapshot_json FROM local_draft WHERE scope=?", receipt.scope);
    const drafts = rows.map(r => JSON.parse(r.snapshot_json) as LocalDraft);
    // SQLite commit may have succeeded immediately before termination. Replay adds nothing.
    if (drafts.some(d => receipt.originals.every(o => d.content.items.some(i => i.id === o.itemId)))) return;
    const destination = drafts.find(d => d.id === receipt.draftId && d.status === "editing" && d.revision === receipt.expectedRevision && d.content.items.length <= 198);
    const id = `recovered-${receipt.captureId}`;
    if (!destination && drafts.some(d => d.id === id)) return;
    const available = receipt.originals.filter(o => exists(o.payload.localUri));
    const items = receipt.originals.map(o => ({ id: o.itemId, assetId: null, localCaptureRef: available.includes(o) ? o.id : null,
      caption: available.includes(o) ? "" : "Live Photo 组件复制中断，请从相册重新导入完整一组。", livePhotoGroupId: receipt.captureId, livePhotoRole: o.role,
      ...(!available.includes(o) ? { preservationState: "missing" as const } : {}) }));
    const row: LocalDraft = destination ?? { id, scope: receipt.scope, content: { ...emptyDraftContent(), title: "恢复的 Live Photo 草稿", visibility: "private", occurredAtPrecision: "unknown" }, revision: 0, serverRevision: 0, mutationId: Crypto.randomUUID(), status: "editing", memoryEventId: null, updatedAt: receipt.createdAt };
    const originals = [];
    for (const o of available) if (!await tx.getFirstAsync("SELECT id FROM local_capture WHERE id=?", o.id)) originals.push(o);
    await saveLocalDraftInTransaction(tx, { ...row, content: { ...row.content, items: [...row.content.items, ...items], coverItemId: row.content.coverItemId ?? items[0]!.id }, revision: row.revision + 1, mutationId: Crypto.randomUUID() }, row.revision, originals);
  });
}
