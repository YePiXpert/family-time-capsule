import { ApiError, requestMobileJson } from "../api/client";
import { getActiveDestination, getDatabase } from "../storage/database";
import { listLocalDrafts } from "../drafts/store";
import type { Credentials, OutboxItem } from "../types";

/** Originals, then Draft, then receipt: four statuses remain independent.
 * A lost acknowledgment can be retried without re-appending any content. */
export async function syncLocalIntake(credentials: Credentials, options: { isCurrent?: () => boolean; authorizeUpload?: (item: OutboxItem) => Promise<boolean> }) {
  const scope = await getActiveDestination();
  if (!scope || !options.authorizeUpload) return;
  const guard = async () => {
    if (options.isCurrent?.() === false || await getActiveDestination() !== scope) throw new ApiError("连接已切换，收件去向仍保留在本机。", 409, "connection_changed");
  };
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ session_id: string; source: string; destination: string; draft_id: string | null; revision: number }>(`SELECT c.*,s.source
    FROM local_intake_choice c JOIN local_import_session s ON s.id=c.session_id
    WHERE c.scope=? AND c.destination<>'pending' AND c.server_revision<c.revision`, scope);
  for (const row of rows) {
    await guard();
    const captures = await db.getAllAsync<{ capture_id: string; kind: string | null; inbox_item_id: string | null; error_code: string | null }>(`SELECT i.capture_id,c.kind,c.inbox_item_id,i.error_code
      FROM local_import_item i LEFT JOIN local_capture c ON c.id=i.capture_id WHERE i.import_session_id=?`, row.session_id);
    const media = captures.filter(capture => capture.kind === "media_capture" && !capture.error_code);
    if (row.destination === "library" && (!media.length || media.some(capture => !capture.inbox_item_id))) continue;
    if (row.destination === "draft") {
      const draft = (await listLocalDrafts(scope)).find(draft => draft.id === row.draft_id);
      if (!draft?.serverRevision || draft.content.visibility !== "family") continue;
    }
    const ids = row.destination === "draft" ? [row.draft_id!] : media.map(capture => capture.capture_id);
    let allowed = true;
    for (const id of ids) if (!await options.authorizeUpload({ id, kind: "text_capture", payload: { text: "已保存收件的去向" }, createdAt: "", attemptCount: 0, lastError: null })) allowed = false;
    if (!allowed) continue;
    await guard();
    await requestMobileJson(credentials, "/api/imports", { method: "POST", body: JSON.stringify({ clientSessionId: row.session_id, source: row.source === "share" ? "share" : "native" }) });
    await guard();
    const result = await requestMobileJson(credentials, `/api/imports/${row.session_id}/destination`, { method: "POST", body: JSON.stringify({ operation: "record", destination: row.destination, draftId: row.draft_id, revision: 0 }) }) as { destination: string; draftId: string | null };
    await guard();
    if (result.destination !== row.destination || result.draftId !== row.draft_id) throw new ApiError("服务器收件已选择其他去向，请打开原收件核对。", 409, "intake_conflict");
    await db.runAsync("UPDATE local_intake_choice SET server_revision=? WHERE session_id=? AND scope=? AND revision=?", row.revision, row.session_id, scope, row.revision);
  }
}
