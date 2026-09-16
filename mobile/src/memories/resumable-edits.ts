import { sameMemoryEdit, type LocalMemoryEdit } from "./edit-model";

/** Opening a reader can create a clean row; only unfinished work belongs on home. */
export function resumableMemoryEdits(rows: readonly LocalMemoryEdit[], scope: string): LocalMemoryEdit[] {
  if (scope === "local") return [];
  return rows.filter(row => row.scope === scope && (
    !sameMemoryEdit(row.content, row.base) ||
    (row.savedContent !== null && !sameMemoryEdit(row.savedContent, row.base)) ||
    row.submission !== null || row.conflict !== null
  )).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.memoryId.localeCompare(b.memoryId));
}

export function resumableMemoryEditTitle(row: LocalMemoryEdit): string {
  return row.content.title.trim() || row.content.bodyText.trim().slice(0, 60) || "这段回忆";
}
