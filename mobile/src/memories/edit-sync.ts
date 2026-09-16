import { randomUUID } from "expo-crypto";
import { ApiError, fetchMobileMemory, patchMobileMemory, requestMobileJson } from "../api/client";
import { emptyDraftContent } from "../drafts/model";
import type { Draft } from "../drafts/model";
import { cacheMemoryDetail, getDatabase } from "../storage/database";
import { getServerCacheRevision } from "../storage/cache-lifecycle";
import type { Credentials, MediaCapturePayload } from "../types";
import { memoryCacheScope } from "./cache-scope";
import { memoryEditContent, memoryEditPatch, sameMemoryEdit } from "./edit-model";
import { changeMemoryEdit, getMemoryEdit, listMemoryEdits } from "./edit-store";

/** Explicit per-memory saves already authorize this edit; original uploads have their own consent. */
export async function syncMemoryEdits(credentials: Credentials, scope: string, userId: string, familyId: string, isCurrent: () => boolean, authorizeOriginal?: (id: string) => boolean | Promise<boolean>) {
  const result = { saved: 0, needsAttention: 0 };
  const cacheScope = memoryCacheScope(credentials, userId, familyId)!;
  for (const initial of await listMemoryEdits(scope)) {
    if (!isCurrent()) break;
    if (initial.conflict || initial.blocked) { result.needsAttention += 1; continue; }
    if (!initial.savedContent && !initial.submission) continue;
    // A receipt can arrive while the user is typing. Keep the submitted bytes and
    // operation ID immutable until acknowledged, including after process death.
    const claimed = await changeMemoryEdit(scope, initial.memoryId, current => {
      if (!current || !isCurrent() || current.blocked || current.conflict || current.submission || !current.savedContent) return current;
      return { ...current, submission: { mutationId: randomUUID(), content: current.savedContent, expectedRevision: current.baseRevision,
        ...(current.savedContent.items?.length ? { stage: { id: randomUUID(), mutationId: randomUUID(), revision: null, items: current.savedContent.items.map(item => ({ ...item, assetId: null })) } } : {}) }, problem: null };
    });
    let submission = claimed?.submission;
    if (!claimed || !submission || !isCurrent()) continue;
    const cacheRevision = getServerCacheRevision();
    try {
      const operationId = submission.mutationId;
      const guard = async () => {
        if (!isCurrent() || (await getMemoryEdit(scope, initial.memoryId))?.submission?.mutationId !== operationId) throw new Error("连接或保存内容已切换，本机输入仍保留。");
      };
      if (submission.content.visibility || submission.stage) {
        const currentMemory = await fetchMobileMemory(credentials, initial.memoryId);
        await guard();
        if (currentMemory.atomicEditVersion !== 1) throw new ApiError("服务器需要更新后才能一并保存正文、素材和读者；本机修改已保留。", 422);
      }
      if (submission.stage) {
        for (const item of submission.content.items ?? []) {
          if (!item.localCaptureRef || !authorizeOriginal || !await authorizeOriginal(item.localCaptureRef)) throw new Error("原件已保存在本机，请在记录页保存并授权这次补传。");
        }
        if (submission.stage.revision === null) {
          await guard();
          const staged = await requestMobileJson(credentials, `/api/mobile/v1/drafts/${encodeURIComponent(submission.stage.id)}`, {
            method: "PUT", body: JSON.stringify({ purpose: "memory_edit", editTargetMemoryId: initial.memoryId, expectedRevision: 0,
              mutationId: submission.stage.mutationId, content: { ...emptyDraftContent(), visibility: "private", readerUserIds: [], items: submission.content.items!.map(item => ({ ...item, assetId: null })) } }),
          }) as Draft;
          if (!Number.isSafeInteger(staged.revision) || staged.revision < 1) throw new ApiError("服务器尚未确认补充素材暂存。", 502);
          await guard();
          const row = await changeMemoryEdit(scope, initial.memoryId, current => current?.submission?.mutationId === operationId && isCurrent()
            ? { ...current, submission: { ...current.submission, stage: { ...current.submission.stage!, revision: staged.revision } } } : current);
          submission = row?.submission;
          if (!submission?.stage) continue;
        }
        const db = await getDatabase();
        const { uploadMediaCaptureReceipt } = await import("../storage/files");
        for (const item of [...submission.stage.items]) {
          if (item.assetId) continue;
          await guard();
          const original = await db.getFirstAsync<{ payload_json: string | null }>("SELECT payload_json FROM local_capture WHERE id=?", item.localCaptureRef!);
          if (!original?.payload_json) throw new Error("本机原件无法读取，请重新添加素材。");
          const progress = submission.stage.uploads?.[item.id];
          const payload = { ...JSON.parse(original.payload_json), uploadId: progress?.id, uploadOffset: progress?.offset ?? 0 } as MediaCapturePayload;
          const receipt = await uploadMediaCaptureReceipt(credentials, item.localCaptureRef!, payload, async (id, offset) => {
            await guard();
            await changeMemoryEdit(scope, initial.memoryId, current => current?.submission?.mutationId === operationId && isCurrent()
              ? { ...current, submission: { ...current.submission, stage: { ...current.submission.stage!, uploads: { ...current.submission.stage!.uploads, [item.id]: { id, offset } } } } } : current);
          }, { draftId: submission.stage.id, guard });
          if (!receipt.assetId) throw new ApiError("服务器未确认私密原件。", 502);
          await guard();
          const row = await changeMemoryEdit(scope, initial.memoryId, current => current?.submission?.mutationId === operationId && isCurrent()
            ? { ...current, submission: { ...current.submission, stage: { ...current.submission.stage!, items: current.submission.stage!.items.map(value => value.id === item.id ? { ...value, assetId: receipt.assetId! } : value) } } } : current);
          submission = row?.submission;
          if (!submission?.stage) break;
        }
      }
      if (!submission) continue;
      await guard();
      const committed = submission;
      const remote = await patchMobileMemory(credentials, initial.memoryId, memoryEditPatch(committed, claimed.timezone));
      if (!isCurrent()) break;
      if ((committed.content.visibility || committed.stage) && remote.mutationReceipt?.mutationId !== committed.mutationId) throw new ApiError("服务器尚未确认整笔保存，稍后重试会继续核对同一回执。", 502);
      // Cache the receipt before clearing the local copy, so a restart cannot
      // briefly expose the pre-edit detail if the timeline refresh is offline.
      if (!await cacheMemoryDetail(cacheScope, remote, cacheRevision) || !isCurrent()) break;
      await changeMemoryEdit(scope, initial.memoryId, current => {
        if (!current || current.submission?.mutationId !== committed.mutationId || !isCurrent()) return current;
        const submittedItems = new Set(committed.content.items?.map(item => item.id) ?? []);
        const remaining = (content: typeof current.content) => content.items ? { ...content, items: content.items.filter(item => !submittedItems.has(item.id)), ...(content.newCoverItemId && submittedItems.has(content.newCoverItemId) ? { newCoverItemId: null, coverAssetId: remote.coverAssetId ?? content.coverAssetId } : {}) } : content;
        const savedContent = sameMemoryEdit(current.savedContent, committed.content) ? null : current.savedContent ? remaining(current.savedContent) : null;
        return { ...current, content: sameMemoryEdit(current.content, committed.content) ? memoryEditContent(remote) : remaining(current.content),
          base: memoryEditContent(remote), baseRevision: remote.titleRevision!,
          appliedItemIds: [...new Set([...(current.appliedItemIds ?? []), ...submittedItems])],
          savedContent, submission: null, conflict: null, problem: null, blocked: false };
      });
      if (committed.content.items?.length) {
        const db = await getDatabase();
        for (const item of committed.content.items) if (item.localCaptureRef) await db.runAsync("UPDATE local_capture SET memory_event_id=?,sync_state='archived' WHERE id=?", initial.memoryId, item.localCaptureRef);
      }
      result.saved += 1;
    } catch (error) {
      if (!isCurrent()) break;
      if (error instanceof ApiError && error.status === 401) throw error;
      if (error instanceof ApiError && error.status === 409) {
        // Keep both sides durably. If fetching the current version fails, retry
        // the same operation later; never quietly rebase over a family edit.
        try {
          const remote = await fetchMobileMemory(credentials, initial.memoryId);
          if (!isCurrent()) break;
          if (!await cacheMemoryDetail(cacheScope, remote, cacheRevision) || !isCurrent()) break;
          await changeMemoryEdit(scope, initial.memoryId, current => current && submission && current.submission?.mutationId === submission.mutationId && isCurrent()
            ? { ...current, submission: null, conflict: { content: memoryEditContent(remote), revision: remote.titleRevision! }, problem: "家人也修改了这段回忆，请核对两份内容。" } : current);
          result.needsAttention += 1;
          continue;
        } catch (readError) { if (readError instanceof ApiError && readError.status === 401) throw readError; }
      }
      const blocked = error instanceof ApiError && [400, 403, 404, 422].includes(error.status);
      await changeMemoryEdit(scope, initial.memoryId, current => current && submission && current.submission?.mutationId === submission.mutationId && isCurrent()
        ? { ...current, blocked, problem: blocked ? "暂时无法同步，请联网打开回忆核对权限和内容。本机修改已保留。" : "已保存在本机，联网后继续同步。" } : current);
      result.needsAttention += 1;
      if (!blocked) break;
    }
  }
  return result;
}
