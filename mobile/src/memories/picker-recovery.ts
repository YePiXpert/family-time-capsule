import { getDatabase } from "../storage/database";
import type { LivePhotoPickerReceipt } from "../native/picker-receipt";
import { changeMemoryEdit } from "./edit-store";

/** An interrupted append remains an edit of the same memory, never a new event. */
export async function recoverMemoryEditLivePhoto(receipt: LivePhotoPickerReceipt, exists: (uri: string) => boolean) {
  if (!receipt.memoryEditTarget) throw new Error("恢复原件缺少目标记录。");
  const db = await getDatabase();
  const available = receipt.originals.filter(original => exists(original.payload.localUri));
  const originals = [];
  for (const original of available) if (!await db.getFirstAsync("SELECT id FROM local_capture WHERE id=?", original.id)) originals.push(original);
  await changeMemoryEdit(receipt.scope, receipt.memoryEditTarget, row => {
    if (!row) throw new Error("原件仍保留，请恢复原账号的记录编辑后重试。");
    const items = row.content.items ?? [];
    if (receipt.originals.every(original => items.some(item => item.id === original.itemId))) return row;
    if (items.length > 198) throw new Error("恢复的原件仍保留，请先为这条记录腾出素材位置。");
    return { ...row, content: { ...row.content, items: [...items, ...receipt.originals.map(original => ({
      id: original.itemId, assetId: null, localCaptureRef: available.includes(original) ? original.id : null,
      caption: available.includes(original) ? "" : "Live Photo 组件复制中断，请重新导入完整一组。",
      livePhotoGroupId: receipt.captureId, livePhotoRole: original.role,
      ...(!available.includes(original) ? { preservationState: "missing" as const } : {}),
    }))] } };
  }, originals);
}


export async function recoverMemoryEditFile(scope: string, memoryId: string, itemId: string, item: import("../types").LocalImportIntakeItem) {
  const db = await getDatabase();
  const payload = item.kind === "file" && item.payload && "localUri" in item.payload ? item.payload : null;
  const original = payload && !await db.getFirstAsync("SELECT id FROM local_capture WHERE id=?", item.captureId) ? [{ id: item.captureId, payload }] : [];
  await changeMemoryEdit(scope, memoryId, row => {
    if (!row) throw new Error("原件仍保留，请恢复原账号的记录编辑后重试。");
    const items = row.content.items ?? [];
    if (items.some(value => value.id === itemId)) return row;
    if (items.length >= 200) throw new Error("恢复的文件仍保留，请先为这条记录腾出素材位置。");
    return { ...row, content: { ...row.content, items: [...items, { id: itemId, assetId: null,
      localCaptureRef: payload ? item.captureId : null, caption: payload ? "" : "文件复制中断，请重新添加。",
      ...(!payload ? { preservationState: "missing" as const } : {}) }] } };
  }, original);
}
