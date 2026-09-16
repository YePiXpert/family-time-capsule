import { useCallback, useEffect, useRef, useState } from "react";
import { randomUUID } from "expo-crypto";
import { ApiError, fetchMobileMemory } from "../api/client";
import { getCachedMemoryDetail, cacheMemoryDetail, removeCachedMemoryDetail } from "../storage/database";
import { getServerCacheRevision } from "../storage/cache-lifecycle";
import { memoryCacheScope } from "./cache-scope";
import type { Credentials, MediaCapturePayload, MobileMemory } from "../types";
import type { Draft, DraftContent, DraftItem } from "../drafts/model";
import { isDraftDateComplete } from "../drafts/model";
import type { DraftOriginal, LocalDraft } from "../drafts/store";
import { applyMemoryDraft, memoryEditContent, memoryEditDraft, sameMemoryEdit, type LocalMemoryEdit, type MemoryEditContent } from "./edit-model";
import { changeMemoryEdit, getMemoryEdit } from "./edit-store";

function asDraft(row: LocalMemoryEdit): LocalDraft {
  return { id: row.memoryId, scope: row.scope, content: memoryEditDraft(row.content), revision: row.revision,
    serverRevision: row.baseRevision, mutationId: row.submission?.mutationId ?? row.memoryId, status: "editing",
    savedContent: memoryEditDraft(row.savedContent ?? row.base), captureTimeEdited: true, memoryEventId: row.memoryId, updatedAt: row.updatedAt };
}

function withoutAcknowledgedOriginals(content: MemoryEditContent, row: LocalMemoryEdit | null) {
  if (!row?.appliedItemIds?.length) return content;
  const applied = new Set(row.appliedItemIds);
  return { ...content, items: content.items?.filter(item => !applied.has(item.id)),
    ...(content.newCoverItemId && applied.has(content.newCoverItemId) ? { newCoverItemId: null, coverAssetId: row.base.coverAssetId ?? content.coverAssetId } : {}) };
}

/** A memory has its own durable editor; new captures never adopt this input. */
export function useMemoryCapture(scope: string, memoryId: string | null, credentials: Credentials | null, timezone: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<LocalMemoryEdit | null>(null);
  const [memory, setMemory] = useState<MobileMemory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const current = useRef<LocalMemoryEdit | null>(null);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const failure = useRef<Error | null>(null);
  const active = useRef(false);
  useEffect(() => {
    let valid = true; active.current = true;
    current.current = null; failure.current = null;
    if (!enabled || !credentials || !memoryId) return () => { valid = false; active.current = false; };
    void (async () => {
      await Promise.resolve();
      if (!valid) return;
      setSnapshot(null); setMemory(null); setError(null);
      const parts = JSON.parse(scope) as string[];
      const cacheScope = memoryCacheScope(credentials, parts[2], parts[3])!;
      const cacheRevision = getServerCacheRevision();
      let remote = await getCachedMemoryDetail(cacheScope, memoryId);
      try {
        const received = await fetchMobileMemory(credentials, memoryId);
        if (!valid) return;
        if (!await cacheMemoryDetail(cacheScope, received, cacheRevision)) throw new ApiError("记录读取权限已变化，请返回后重新打开。", 403);
        remote = received;
      } catch (reason) {
        if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) {
          if (valid) await removeCachedMemoryDetail(cacheScope, memoryId);
          throw reason;
        }
        if (!(reason instanceof ApiError) || reason.status !== 0 || !remote) throw reason;
      }
      if (!valid) return;
      if (!remote?.canWrite) throw new Error("当前账号不能编辑这条记录，已输入的内容仍保存在原账号下。");
      if (remote.atomicEditVersion !== 1) throw new Error("请先更新服务器并联网打开记录，才能一并编辑文字、素材和读者。");
      const existing = await getMemoryEdit(scope, memoryId);
      if (!valid) return;
      const base = memoryEditContent(remote);
      const keep = existing && (existing.savedContent || existing.submission || existing.conflict || !sameMemoryEdit(existing.content, existing.base) || existing.baseRevision >= remote.titleRevision!);
      const row: LocalMemoryEdit = keep ? { ...existing, atomicEditVersion: 1,
        content: { ...base, ...existing.content, items: existing.content.items ?? [] }, base: { ...base, ...existing.base } }
        : { scope, memoryId, base, content: base, baseRevision: remote.titleRevision!, timezone,
          atomicEditVersion: 1, savedContent: null, submission: null, conflict: null, blocked: false, problem: null, revision: 0, updatedAt: new Date().toISOString() };
      const persisted = await changeMemoryEdit(scope, memoryId, latest => {
        if (!valid) return latest;
        if (latest && (latest.submission || latest.savedContent || latest.conflict || !sameMemoryEdit(latest.content, latest.base))) return { ...latest, atomicEditVersion: 1, content: { ...base, ...latest.content, items: latest.content.items ?? [] } };
        return row;
      });
      if (!valid || !persisted) return;
      current.current = persisted; setSnapshot(persisted); setMemory(remote); setSaved(true);
    })().catch(reason => { if (valid) setError(reason instanceof Error ? reason.message : "暂时无法打开编辑内容。"); });
    return () => { valid = false; active.current = false; };
  }, [scope, memoryId, credentials, timezone, enabled, reloadKey]);

  const persist = useCallback((content: MemoryEditContent, originals: DraftOriginal[] = []) => {
    const opened = current.current;
    if (!opened || !active.current) return Promise.reject(new Error("请先打开可以编辑的记录。"));
    const next = { ...opened, content, revision: opened.revision + 1 };
    current.current = next; setSnapshot(next); setSaved(false);
    const operation = writes.current.then(async () => {
      if (failure.current) throw failure.current;
      const stored = await changeMemoryEdit(scope, opened.memoryId, latest => ({ ...(latest ?? opened), content: withoutAcknowledgedOriginals(content, latest),
        // The base seen at open stays pinned until a submitted save is acknowledged.
        atomicEditVersion: 1 }), originals);
      if (active.current && current.current?.content === content && stored) { current.current = stored; setSnapshot(stored); setSaved(true); }
      if (active.current) setError(null);
    });
    writes.current = operation.catch(reason => { failure.current = reason instanceof Error ? reason : new Error("本机暂存失败。"); if (active.current) setError(failure.current.message); });
    return operation;
  }, [scope]);
  const barrier = useCallback(async () => { await writes.current; if (failure.current) throw failure.current; }, []);
  const change = useCallback((patch: Partial<DraftContent>) => {
    const row = current.current; if (row) void persist(applyMemoryDraft(row.content, patch)).catch(() => {});
  }, [persist]);
  const setCoverAsset = useCallback((id: string) => { const row = current.current; if (row) void persist({ ...row.content, coverAssetId: id, newCoverItemId: null }).catch(() => {}); }, [persist]);
  const addOriginals = useCallback(async (originals: (DraftOriginal & { existing?: boolean; item?: Pick<DraftItem, "id" | "livePhotoGroupId" | "livePhotoRole"> })[], destination?: { scope: string; id: string }) => {
    const row = current.current;
    if (!row || (destination && (destination.scope !== scope || destination.id !== row.memoryId))) throw new Error("连接或记录已切换，未向其他记录添加素材。");
    const previous = row.content.items ?? [];
    if ((memory?.assets.length ?? 0) + previous.length + originals.length > 200) throw new Error("这条记录最多保存 200 份素材。");
    const items: DraftItem[] = originals.map(original => ({ id: original.item?.id ?? randomUUID(), ...original.item, assetId: null, localCaptureRef: original.id, caption: "" }));
    try { await persist({ ...row.content, items: [...previous, ...items] }, originals.filter(value => !value.existing)); }
    catch (reason) {
      const ids = new Set(items.map(item => item.id));
      const live = current.current;
      if (live) { current.current = { ...live, content: { ...live.content, items: live.content.items?.filter(item => !ids.has(item.id)) } }; setSnapshot(current.current); }
      throw reason;
    }
  }, [scope, memory?.assets.length, persist]);
  const addOriginal = useCallback((id: string, payload: MediaCapturePayload, existing = false) => addOriginals([{ id, payload, existing }]), [addOriginals]);
  const save = useCallback(async (_publish: boolean, _intent?: "draft" | "review", _organize?: boolean) => {
    await barrier(); const row = current.current;
    if (!row) throw new Error("还没有读取可编辑的记录。");
    if (!isDraftDateComplete(memoryEditDraft(row.content))) throw new Error("请选择发生时间，或标为时间不确定。");
    if (row.content.items?.some(item => item.preservationState === "missing")) throw new Error("有原件缺失，请重新添加完整素材或移除后保存。");
    if (row.content.visibility === "members" && !row.content.readerUserIds?.length) throw new Error("请选择至少一位家人。");
    const stored = await changeMemoryEdit(scope, row.memoryId, latest => {
      const live = latest ?? row;
      if (live.conflict) throw new Error("家人也修改了这条记录，请返回阅读页核对两份内容。");
      const content = withoutAcknowledgedOriginals(row.content, live);
      return { ...live, content, savedContent: content, blocked: false, problem: null,
        submission: live.blocked ? null : live.submission, atomicEditVersion: 1 };
    });
    current.current = stored; setSnapshot(stored); setSaved(true); setError(null);
    return asDraft(stored!);
  }, [barrier, scope]);
  const retry = useCallback(async () => { await writes.current; failure.current = null; if (current.current) await persist(current.current.content); else setReloadKey(value => value + 1); }, [persist]);
  const reload = useCallback(async () => {
    await writes.current;
    if (memoryId && !failure.current && current.current) {
      const row = await getMemoryEdit(scope, memoryId);
      if (active.current && row && row.revision > current.current.revision) { current.current = row; setSnapshot(row); }
    }
    return [] as LocalDraft[];
  }, [scope, memoryId]);
  const discard = useCallback(async () => { await barrier(); if (current.current) await persist(current.current.savedContent ?? current.current.base); }, [barrier, persist]);
  const noChange = useCallback(async () => {}, []);
  const bind = useCallback(async (_id: string) => { throw new Error("请从首页继续原本机草稿。"); }, []);
  const resume = useCallback(async (_row: LocalDraft) => {}, []);
  const continueServer = useCallback(async (_remote: Draft, _isCurrent?: () => boolean) => {}, []);
  const visible = enabled && snapshot?.scope === scope && snapshot.memoryId === memoryId ? snapshot : null;
  return { draft: visible ? asDraft(visible) : null, memory: visible && memory?.id === memoryId ? memory : null, edit: visible, saved, error, barrier,
    change, setCoverAsset, addOriginal, addOriginals, save, retry, reload, discard, create: noChange, reopen: noChange, bind, resume, continueServer,
    drafts: [] as LocalDraft[], serverDrafts: [] as Draft[], unboundDrafts: [] as LocalDraft[] };
}
