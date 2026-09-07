import { getDatabase } from "../storage/database";
import { classifyImportedFile } from "../storage/import-policy";
import type { MediaCapturePayload } from "../types";
const mediaMime: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif", webp: "image/webp", gif: "image/gif", mov: "video/quicktime", mp4: "video/mp4", m4v: "video/x-m4v", m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav", aac: "audio/aac" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
/** Repair the former queue:false gap using the existing durable receipt and
 * original file. Never guess its original filename/time, copy it, or upload it. */
export async function recoverCopiedIntakeCaptures(captureRoot: string, fileExists: (uri: string) => boolean) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ capture_id: string; local_uri: string; source: "files" | "share"; created_at: string }>(`SELECT i.capture_id,i.local_uri,s.source,i.created_at
    FROM local_import_item i JOIN local_import_session s ON s.id=i.import_session_id
    WHERE i.intake_state='copied' AND i.local_uri IS NOT NULL AND i.error_code IS NULL
      AND NOT EXISTS(SELECT 1 FROM local_capture c WHERE c.id=i.capture_id) ORDER BY i.id LIMIT 1000`);
  let recovered = 0, unavailable = 0;
  for (const row of rows) {
    const prefix = `${captureRoot.replace(/\/$/u, "")}/${row.capture_id}.`;
    const extension = row.local_uri.startsWith(prefix) ? row.local_uri.slice(prefix.length).toLowerCase() : "";
    const fileName = `原文件名未保留.${extension}`;
    const classified = /^[a-z0-9]{1,8}$/u.test(extension) ? classifyImportedFile(fileName, mediaMime[extension]) : null;
    let exists = false;
    try { exists = uuid.test(row.capture_id) && Boolean(classified) && fileExists(row.local_uri); } catch { /* Keep the receipt available for the next recovery attempt. */ }
    if (!exists || !classified) { unavailable++; continue; }
    const payload: MediaCapturePayload = { ...classified, fileName, localUri: row.local_uri, lastModified: null, source: row.source === "share" ? "system_share" : "files" };
    const result = await db.runAsync(`INSERT OR IGNORE INTO local_capture(id,kind,title,occurred_at,local_uri,media_type,payload_json,title_source,sync_state)
      VALUES(?,'media_capture',?,?,?,?,?,'rule_generated','pending')`, row.capture_id, "恢复的本机资料", row.created_at, row.local_uri, payload.mediaType, JSON.stringify(payload));
    recovered += result.changes;
  }
  return { recovered, unavailable };
}
