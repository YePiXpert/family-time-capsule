import { getDatabase, type LocalCaptureDetail, getLocalCaptureDetail } from "../storage/database";
import { emptyDraftContent } from "../drafts/model";
import { saveLocalDraftInTransaction, type LocalDraft } from "../drafts/store";
import type { TextCapturePayload } from "../types";

export type IntakeChoice = { scope: string; destination: "pending" | "draft" | "library"; draft_id: string | null; revision: number };
export type IntakeDetail = { id: string; source: string; choice: IntakeChoice; items: { captureId: string; error: string | null; original: LocalCaptureDetail | null }[] };
export async function getLocalIntake(id: string, scope: string): Promise<IntakeDetail | null> {
  const db = await getDatabase();
  const session = await db.getFirstAsync<{ source: string }>("SELECT source FROM local_import_session WHERE id=?", id);
  if (!session) return null;
  const choice = await db.getFirstAsync<IntakeChoice>("SELECT * FROM local_intake_choice WHERE session_id=?", id)
    ?? { scope: "local", destination: "pending" as const, draft_id: null, revision: 0 };
  if (choice.scope !== scope && choice.scope !== "local") return null;
  const rows = await db.getAllAsync<{ capture_id: string; error_code: string | null }>("SELECT capture_id,error_code FROM local_import_item WHERE import_session_id=? ORDER BY sort_order,id", id);
  return { id, source: session.source, choice, items: await Promise.all(rows.map(async row => ({ captureId: row.capture_id, error: row.error_code, original: await getLocalCaptureDetail(row.capture_id) }))) };
}

/** Commit the receipt's destination and draft references / upload intent together.
 * A repeated tap cannot duplicate text or create a second draft. No network/filesystem I/O. */
export async function chooseLocalIntake(input: {
  id: string; scope: string; expectedRevision: number; destination: "draft" | "library";
  draftId?: string; draftRevision?: number; mutationId: string;
  selectedCaptureIds?: string[]; coverCaptureId?: string | null; refine?: boolean;
  queueUpload?: boolean;
}): Promise<{ draftId: string | null; uploadIds: string[] }> {
  const db = await getDatabase();
  const result: { draftId: string | null; uploadIds: string[] } = { draftId: input.draftId ?? null, uploadIds: [] };
  await db.withExclusiveTransactionAsync(async tx => {
    if (!await tx.getFirstAsync("SELECT id FROM local_import_session WHERE id=?", input.id)) throw new Error("找不到本机收件。");
    await tx.runAsync("INSERT OR IGNORE INTO local_intake_choice(session_id,scope) VALUES(?,'local')", input.id);
    const choice = (await tx.getFirstAsync<IntakeChoice>("SELECT * FROM local_intake_choice WHERE session_id=?", input.id))!;
    if (choice.scope !== "local" && choice.scope !== input.scope) throw new Error("这份收件属于其他账号或家庭，请切回原来的连接。");
    const refiningDraft = input.refine === true && choice.destination === "draft" && input.destination === "draft"
      && choice.scope === input.scope && choice.draft_id === input.draftId;
    if (input.refine && !refiningDraft) throw new Error("请从这批导入原来关联的草稿继续挑选。");
    if (choice.destination !== "pending") {
      // Library-only originals can later be explicitly sent from local to a family.
      const bindingLibrary = choice.destination === "library" && input.destination === "library"
        && ((choice.scope === "local" && input.scope !== "local") || (choice.scope === input.scope && input.queueUpload !== false));
      const choosingFromLibrary = choice.destination === "library" && input.destination === "draft";
      if (!bindingLibrary && !refiningDraft && !choosingFromLibrary) {
        if (choice.destination === input.destination && choice.draft_id === (input.draftId ?? null)) { result.draftId = choice.draft_id; return; }
        throw new Error("这份收件已经选好了去向，请从原草稿或资料库继续。");
      }
    }
    if (choice.revision !== input.expectedRevision) throw new Error("收件已在另一处更新，请重新打开。");
    const rows = await tx.getAllAsync<{ capture_id: string; kind: string | null; media_type: string | null; payload_json: string | null; inbox_item_id: string | null; created_at: string; error_code: string | null }>(`SELECT i.capture_id,c.kind,c.media_type,c.payload_json,c.inbox_item_id,i.created_at,i.error_code
      FROM local_import_item i LEFT JOIN local_capture c ON c.id=i.capture_id WHERE i.import_session_id=? ORDER BY i.sort_order,i.id`, input.id);
    const available = rows.filter(row => row.payload_json && !row.error_code);
    if (!available.length) throw new Error("没有可用的本机内容，请先处理复制错误。");
    if (input.selectedCaptureIds && (!Array.isArray(input.selectedCaptureIds) || input.selectedCaptureIds.some(id => typeof id !== "string" || !available.some(row => row.capture_id === id))
      || new Set(input.selectedCaptureIds).size !== input.selectedCaptureIds.length)) throw new Error("部分挑选的原件已不可用，请重新打开核对。");
    const selectedIds = new Set(input.selectedCaptureIds ?? available.map(row => row.capture_id));
    const chosen = input.destination === "draft" ? available.filter(row => selectedIds.has(row.capture_id)) : available;
    if (input.destination === "draft" && !chosen.length) throw new Error("先挑选至少一份内容，再加入草稿。");
    if (input.coverCaptureId && !chosen.some(row => row.capture_id === input.coverCaptureId && row.media_type === "image")) throw new Error("封面需要从已选照片中指定。");
    const refs = await tx.getAllAsync<{ scope: string; capture_id: string }>(`SELECT DISTINCT d.scope,json_extract(j.value,'$.localCaptureRef') AS capture_id FROM local_draft d,
      json_each(json_extract(d.snapshot_json,'$.content.items')) j
      WHERE json_extract(j.value,'$.localCaptureRef') IN (SELECT capture_id FROM local_import_item WHERE import_session_id=?)`, input.id);
    if (refs.some(row => row.scope !== input.scope)) throw new Error("素材已被其他账号或本机草稿引用，请先在原草稿确认家庭。");
    if (input.destination === "draft") {
      if (!input.draftId) throw new Error("请选择草稿。");
      const saved = await tx.getFirstAsync<{ snapshot_json: string }>("SELECT snapshot_json FROM local_draft WHERE scope=? AND id=?", input.scope, input.draftId);
      const previous = saved ? JSON.parse(saved.snapshot_json) as LocalDraft : null;
      if (previous && previous.status !== "editing") throw new Error("请先把草稿切回继续编辑。");
      if ((previous?.revision ?? 0) !== (input.draftRevision ?? 0)) throw new Error("草稿已修改，请重新选择。");
      const content = previous?.content ?? emptyDraftContent();
      const batchIds = new Set(rows.map(row => row.capture_id));
      const items = refiningDraft ? content.items.filter(item => !item.localCaptureRef || !batchIds.has(item.localCaptureRef) || selectedIds.has(item.localCaptureRef)) : [...content.items];
      for (const item of items) if (item.livePhotoGroupId && !items.some(other => other.id !== item.id && other.livePhotoGroupId === item.livePhotoGroupId)) {
        throw new Error("Live Photo 的照片和动态原片需要同时保留，请一起选择。");
      }
      const texts: string[] = [];
      for (const row of chosen) {
        if (row.kind === "text_capture") { if (!refiningDraft) texts.push((JSON.parse(row.payload_json!) as TextCapturePayload).text); }
        else if (!items.some(item => item.localCaptureRef === row.capture_id)) items.push({ id: row.capture_id, assetId: null, localCaptureRef: row.capture_id, caption: "" });
      }
      const text = [content.text, ...texts].filter(Boolean).join("\n\n");
      if (text.length > 5000 || items.length > 200) throw new Error("这批内容超过一份草稿的容量，请先仅存资料库，再挑选素材组成记忆。");
      const next: LocalDraft = { ...(previous ?? { id: input.draftId, scope: input.scope, serverRevision: 0, status: "editing", memoryEventId: null }),
        revision: (previous?.revision ?? 0) + 1, mutationId: input.mutationId, updatedAt: new Date().toISOString(),
        content: { ...content, text, items, coverItemId: input.coverCaptureId === null ? null : input.coverCaptureId
          ? items.find(item => item.localCaptureRef === input.coverCaptureId)?.id ?? null
          : items.some(item => item.id === content.coverItemId) ? content.coverItemId : items[0]?.id ?? null } };
      await saveLocalDraftInTransaction(tx, next, previous?.revision ?? 0);
    } else {
      result.draftId = null;
      // Text remains readable in the receipt. A library contains originals;
      // choosing it must never manufacture a text-only event or diary.
      if (input.scope !== "local" && input.queueUpload !== false) for (const row of available) {
        if (row.kind !== "media_capture" || row.inbox_item_id) continue;
        await tx.runAsync("INSERT OR IGNORE INTO outbox(id,kind,payload_json,created_at) VALUES(?,'media_capture',?,?)", row.capture_id, row.payload_json, row.created_at);
        await tx.runAsync("UPDATE local_import_item SET intake_state='queued' WHERE capture_id=? AND intake_state='copied'", row.capture_id);
        result.uploadIds.push(row.capture_id);
      }
    }
    await tx.runAsync("UPDATE local_intake_choice SET scope=?,destination=?,draft_id=?,revision=revision+1 WHERE session_id=?", input.scope, input.destination, result.draftId, input.id);
  });
  if (input.destination === "library" && input.scope !== "local" && input.queueUpload !== false) {
    // Recover consent after termination between the local commit and the UI's
    // grantSyncConsent call, without creating a second upload queue entry.
    const pending = await db.getAllAsync<{ id: string }>(`SELECT o.id FROM outbox o JOIN local_import_item i ON i.capture_id=o.id
      JOIN local_intake_choice c ON c.session_id=i.import_session_id WHERE c.session_id=? AND c.scope=? AND c.destination='library'`, input.id, input.scope);
    result.uploadIds = pending.map(row => row.id);
  }
  return result;
}

/** Files was opened from this Draft. Record that completed user choice without
 * re-appending items or racing the editor's own autosave revision. */
export async function recordLocalIntakeDraft(id: string, scope: string, draftId: string): Promise<void> {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async tx => {
    const choice = await tx.getFirstAsync<IntakeChoice>("SELECT * FROM local_intake_choice WHERE session_id=?", id);
    if (!choice || choice.scope !== scope) throw new Error("文件收件的账号已变化，请重新打开核对。");
    if (choice.destination === "draft" && choice.draft_id === draftId) return;
    if (choice.destination !== "pending") throw new Error("文件收件已选择其他去向。");
    const saved = await tx.getFirstAsync<{ snapshot_json: string }>("SELECT snapshot_json FROM local_draft WHERE scope=? AND id=?", scope, draftId);
    if (!saved) throw new Error("文件已经保存，但原草稿尚未读到，请从收到的内容继续。");
    const draft = JSON.parse(saved.snapshot_json) as LocalDraft;
    const refs = new Set(draft.content.items.map(item => item.localCaptureRef));
    const captures = await tx.getAllAsync<{ capture_id: string }>("SELECT capture_id FROM local_import_item WHERE import_session_id=? AND error_code IS NULL", id);
    if (!captures.length || captures.some(row => !refs.has(row.capture_id))) throw new Error("部分文件尚未加入草稿，请从收到的内容继续。");
    await tx.runAsync("UPDATE local_intake_choice SET destination='draft',draft_id=?,revision=revision+1 WHERE session_id=?", draftId, id);
  });
}
