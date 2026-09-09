import * as Crypto from "expo-crypto";
import { uploadMediaCaptureReceipt } from "../storage/files";
import { ApiError, requestMobileJson } from "../api/client";
import { getActiveDestination, getDatabase } from "../storage/database";
import { listLocalDrafts, saveLocalDraft, type LocalDraft } from "./store";
import { parseDraftContent, reconcileDraftAsset, type Draft } from "./model";
import type { CaptureProcessing } from "./capture";
import type { Credentials, OutboxItem, MediaCapturePayload } from "../types";

/** Runs after originals, under the same account/family generation and upload consent gate. */
export async function syncLocalDrafts(credentials: Credentials, options: { isCurrent?: () => boolean; authorizeUpload?: (item: OutboxItem) => Promise<boolean> }) {
  const scope = await getActiveDestination();
  if (!scope) return;
  const guard = async () => {
    if (options.isCurrent?.() === false || await getActiveDestination() !== scope) throw new ApiError("连接已切换，草稿仍保留。", 409, "connection_changed");
  };
  const db = await getDatabase();
  for (const original of await listLocalDrafts(scope)) {
    if (original.status === "discarded" && original.discardPending) {
      await guard();
      try {
        await requestMobileJson(credentials, `/api/mobile/v1/drafts/${original.id}`, { method: "DELETE", body: JSON.stringify({ expectedRevision: original.serverRevision }) });
        await guard();
        await saveLocalDraft({ ...original, discardPending: false, revision: original.revision + 1 }, original.revision);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        await guard();
        await saveLocalDraft({ ...original, discardPending: false, revision: original.revision + 1 }, original.revision);
      }
      continue;
    }
    if (original.status !== "queued") continue;
    await guard();
    const authorizationItem: OutboxItem = { id: original.id, kind: "text_capture", payload: { text: original.content.text || original.content.title || "家庭草稿" }, createdAt: original.updatedAt, attemptCount: 0, lastError: null };
    if (!options.authorizeUpload || !await options.authorizeUpload(authorizationItem)) continue;
    await guard();
    let row = original;
    const guardRevision = async () => {
      await guard();
      const live = (await listLocalDrafts(scope)).find(d => d.id === row.id);
      if (!live || live.revision !== row.revision || live.status !== "queued") throw new ApiError("草稿已暂停或修改，发送已停止。已送达的结果会在下次同步核对。", 409, "draft_changed");
    };
    const update = async (next: LocalDraft) => { await guardRevision(); await saveLocalDraft(next, row.revision); row = next; };
    try {
      const remote = await requestMobileJson(credentials, `/api/mobile/v1/drafts/${row.id}`) as Draft;
      await guard();
      if (remote.status === "published" && remote.memoryEventId) {
        await update({ ...row, content: { ...row.content, occurredAt: remote.occurredAt, occurredAtPrecision: remote.occurredAtPrecision }, status: "published", memoryEventId: remote.memoryEventId, serverRevision: remote.revision, revision: row.revision + 1 });
        for (const item of row.content.items) if (item.localCaptureRef) await db.runAsync("UPDATE local_capture SET memory_event_id=?,sync_state='archived' WHERE id=?", remote.memoryEventId, item.localCaptureRef);
        continue;
      }
    } catch (error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; }
    if (row.content.items.some(item => !item.assetId)) {
      await guardRevision();
      const saved = await requestMobileJson(credentials, `/api/mobile/v1/drafts/${row.id}`, { method: "PUT", body: JSON.stringify({ expectedRevision: row.serverRevision, mutationId: row.mutationId, content: row.content }) }) as Draft;
      parseDraftContent(saved);
      await update({ ...row, serverRevision: saved.revision, revision: row.revision + 1 });
    }
    for (const item of [...row.content.items]) {
      if (item.assetId) continue;
      const capture = await db.getFirstAsync<{ payload_json: string | null }>("SELECT payload_json FROM local_capture WHERE id=?", item.localCaptureRef!);
      if (!capture?.payload_json) throw new Error("本机草稿原件不可读。");
      const payload = JSON.parse(capture.payload_json) as MediaCapturePayload;
      const intake = await db.getFirstAsync<{ import_session_id: string }>("SELECT import_session_id FROM local_import_item WHERE capture_id=?", item.localCaptureRef!);
      if (intake) payload.importSessionId = intake.import_session_id;
      const receipt = await uploadMediaCaptureReceipt(credentials, item.localCaptureRef!, payload, async (uploadId, uploadOffset) => {
        await guardRevision();
        payload.uploadId = uploadId; payload.uploadOffset = uploadOffset;
        await db.runAsync("UPDATE local_capture SET payload_json=? WHERE id=?", JSON.stringify(payload), item.localCaptureRef!);
      }, { draftId: row.id, guard: guardRevision });
      if (!receipt.assetId) throw new ApiError("服务器未确认私密原件。", 502);
      await update({ ...row, content: { ...row.content, ...reconcileDraftAsset(row.content, item.id, receipt.assetId) }, mutationId: Crypto.randomUUID(), revision: row.revision + 1 });
    }
    await guardRevision();
    const received = await requestMobileJson(credentials, `/api/mobile/v1/drafts/${row.id}`, { method: "PUT", body: JSON.stringify({ expectedRevision: row.serverRevision, mutationId: row.mutationId, content: row.content }) }) as Draft;
    parseDraftContent(received);
    await update({ ...row, serverRevision: received.revision, revision: row.revision + 1 });
    if (row.syncIntent === "draft" || row.syncIntent === "review") {
      await guardRevision();
      const result = row.syncIntent === "review" ? await requestMobileJson(credentials, `/api/mobile/v1/drafts/${row.id}/submit`, { method: "POST", body: JSON.stringify({ expectedRevision: received.revision }) }) as Draft : received;
      parseDraftContent(result);
      await update({ ...row, status: "editing", syncedRevision: row.revision + 1, serverRevision: result.revision, revision: row.revision + 1 });
      continue;
    }
    await guardRevision();
    const result = received.status === "published" ? received : await requestMobileJson(credentials, `/api/mobile/v1/drafts/${row.id}/publish`, { method: "POST", body: JSON.stringify({ expectedRevision: received.revision, quickSave: true, inferTime: !row.captureTimeEdited, organize: row.organizeOnPublish === true, organizeMode: "automatic" }) }) as Draft & { processing?: CaptureProcessing };
    parseDraftContent(result);
    if (result.status !== "published" || typeof result.memoryEventId !== "string") throw new ApiError("服务器尚未确认记忆创建。", 502);
    await update({ ...row, content: { ...row.content, occurredAt: result.occurredAt, occurredAtPrecision: result.occurredAtPrecision }, processing: (result as Draft & { processing?: CaptureProcessing }).processing, status: "published", memoryEventId: result.memoryEventId, serverRevision: result.revision, revision: row.revision + 1 });
    for (const item of row.content.items) if (item.localCaptureRef) await db.runAsync("UPDATE local_capture SET memory_event_id=?,sync_state='archived' WHERE id=?", result.memoryEventId, item.localCaptureRef);
  }
}
