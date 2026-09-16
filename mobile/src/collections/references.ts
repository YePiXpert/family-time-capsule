import type { SQLiteDatabase } from "expo-sqlite";
import type { LocalAlbum } from "./local-types";
/** Pure transaction helpers: importing a draft store must not initialize native UI modules. */
export async function rebindAlbumDraftReferences(
  tx: SQLiteDatabase,
  draftId: string,
  targetScope: string,
) {
  const rows = await tx.getAllAsync<{ snapshot_json: string }>(
    "SELECT snapshot_json FROM local_album WHERE scope IN ('local',?)",
    targetScope,
  );
  for (const raw of rows) {
    const row = JSON.parse(raw.snapshot_json) as LocalAlbum;
    if (
      !row.items.some(
        (i) =>
          i.ref.kind === "localDraft" &&
          i.ref.scope === "local" &&
          i.ref.id === draftId,
      )
    )
      continue;
    const next = {
      ...row,
      items: row.items.map((i) =>
        i.ref.kind === "localDraft" &&
        i.ref.scope === "local" &&
        i.ref.id === draftId
          ? { ...i, ref: { ...i.ref, scope: targetScope } }
          : i,
      ),
      revision: row.revision + 1,
    };
    // Binding one source never publishes or changes the private album's owning scope.
    await tx.runAsync(
      "UPDATE local_album SET snapshot_json=?,revision=? WHERE scope=? AND id=?",
      JSON.stringify(next),
      next.revision,
      row.scope,
      row.id,
    );
  }
}
export async function albumReferencesDraft(
  tx: SQLiteDatabase,
  scope: string,
  id: string,
): Promise<boolean> {
  return !!(await tx.getFirstAsync(
    "SELECT a.id FROM local_album a,json_each(json_extract(a.snapshot_json,'$.items')) i WHERE json_extract(i.value,'$.ref.kind')='localDraft' AND json_extract(i.value,'$.ref.scope')=? AND json_extract(i.value,'$.ref.id')=? LIMIT 1",
    scope,
    id,
  ));
}
