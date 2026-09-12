import { randomUUID } from "expo-crypto";
import { ApiError, fetchMobileMemory, patchMobileMemory } from "../api/client";
import { cacheMemoryDetail } from "../storage/database";
import { getServerCacheRevision } from "../storage/cache-lifecycle";
import type { Credentials } from "../types";
import { memoryCacheScope } from "./cache-scope";
import { memoryEditContent, memoryEditPatch, sameMemoryEdit } from "./edit-model";
import { changeMemoryEdit, listMemoryEdits } from "./edit-store";

/** Explicit per-memory saves already authorize this edit; original uploads have their own consent. */
export async function syncMemoryEdits(credentials: Credentials, scope: string, userId: string, familyId: string, isCurrent: () => boolean) {
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
      return { ...current, submission: { mutationId: randomUUID(), content: current.savedContent, expectedRevision: current.baseRevision }, problem: null };
    });
    const submission = claimed?.submission;
    if (!claimed || !submission || !isCurrent()) continue;
    const cacheRevision = getServerCacheRevision();
    try {
      const remote = await patchMobileMemory(credentials, initial.memoryId, memoryEditPatch(submission, claimed.timezone));
      if (!isCurrent()) break;
      // Cache the receipt before clearing the local copy, so a restart cannot
      // briefly expose the pre-edit detail if the timeline refresh is offline.
      if (!await cacheMemoryDetail(cacheScope, remote, cacheRevision) || !isCurrent()) break;
      await changeMemoryEdit(scope, initial.memoryId, current => {
        if (!current || current.submission?.mutationId !== submission.mutationId || !isCurrent()) return current;
        const savedContent = sameMemoryEdit(current.savedContent, submission.content) ? null : current.savedContent;
        return { ...current, content: sameMemoryEdit(current.content, submission.content) ? memoryEditContent(remote) : current.content,
          base: memoryEditContent(remote), baseRevision: remote.titleRevision!,
          savedContent, submission: null, conflict: null, problem: null, blocked: false };
      });
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
          await changeMemoryEdit(scope, initial.memoryId, current => current?.submission?.mutationId === submission.mutationId && isCurrent()
            ? { ...current, submission: null, conflict: { content: memoryEditContent(remote), revision: remote.titleRevision! }, problem: "家人也修改了这段回忆，请核对两份内容。" } : current);
          result.needsAttention += 1;
          continue;
        } catch (readError) { if (readError instanceof ApiError && readError.status === 401) throw readError; }
      }
      const blocked = error instanceof ApiError && [400, 403, 404, 422].includes(error.status);
      await changeMemoryEdit(scope, initial.memoryId, current => current?.submission?.mutationId === submission.mutationId && isCurrent()
        ? { ...current, blocked, problem: blocked ? "暂时无法同步，请联网打开回忆核对权限和内容。本机修改已保留。" : "已保存在本机，联网后继续同步。" } : current);
      result.needsAttention += 1;
      if (!blocked) break;
    }
  }
  return result;
}
