import type { LocalDraft } from "./store";

/** Saved/queued records are readable content, not unfinished writing. */
export function resumableDrafts(rows: readonly LocalDraft[], scope: string): LocalDraft[] {
  return rows.filter(row => row.scope === scope && row.status === "editing" && !row.discardPending && (
    row.content.text.trim() || row.content.title.trim() || row.content.items.length > 0
  )).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

export function resumableDraftTitle(row: LocalDraft): string {
  return row.content.title.trim() || row.content.text.trim().slice(0, 60) || `${row.content.items.length} 份照片与声音`;
}
