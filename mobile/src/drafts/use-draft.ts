import { useCallback, useEffect, useRef, useState } from "react";
import * as Crypto from "expo-crypto";
import { bindLocalDraft, createLocalDraft, listLocalDrafts, queueDraftOriginals, saveLocalDraft, type LocalDraft, type DraftOriginal } from "./store";
import { requestMobileJson } from "../api/client";
import { isDraftDateComplete, parseDraftContent, type Draft, type DraftContent, type DraftItem } from "./model";
import type { Credentials, MediaCapturePayload } from "../types";
export function usePersistentDraft(scope: string, enabled: boolean, credentials: Credentials | null) {
  const [draft, setDraft] = useState<LocalDraft | null>(null);
  const [drafts, setDrafts] = useState<LocalDraft[]>([]);
  const [serverState, setServerState] = useState<{ scope: string; drafts: Draft[] }>({ scope: "", drafts: [] });
  const [unboundDrafts, setUnboundDrafts] = useState<LocalDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const current = useRef<LocalDraft | null>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const revision = useRef(0);
  const failure = useRef(false);
  const write = useCallback((next: LocalDraft, original?: DraftOriginal | DraftOriginal[]) => {
    current.current = next; setDraft(next); setSaved(false);
    const operation = writes.current.then(async () => {
      if (failure.current) throw new Error("本机保存失败，请重试后继续。");
      await saveLocalDraft(next, revision.current, original);
      revision.current = next.revision;
      if (current.current?.revision === next.revision) setSaved(true);
      setError(null);
    });
    writes.current = operation.catch(e => { failure.current = true; setError(e instanceof Error ? e.message : "无法写入本机，请检查磁盘空间。"); });
    return operation;
  }, []);
  const reload = useCallback(async () => {
    const rows = await listLocalDrafts(scope); setDrafts(rows);
    if (scope !== "local") setUnboundDrafts((await listLocalDrafts("local")).filter(d => d.status === "editing" || d.status === "queued"));
    const live = current.current;
    const newer = live && rows.find(d => d.id === live.id && d.revision > live.revision);
    if (newer && live.revision === revision.current && !failure.current) { current.current = newer; revision.current = newer.revision; setDraft(newer); }
    return rows;
  }, [scope]);
  const create = useCallback(async () => {
    await writes.current;
    if (failure.current) return;
    const row = await createLocalDraft(scope, Crypto.randomUUID(), Crypto.randomUUID());
    current.current = row; revision.current = row.revision; setDraft(row); setSaved(true); await reload();
  }, [scope, reload]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      await writes.current;
      if (!active) return;
      current.current = null; revision.current = 0; failure.current = false;
      if (!enabled) return;
      const rows = await reload();
      if (!active) return;
      const row = rows.find(d => d.status === "editing" || d.status === "queued");
      if (row) { current.current = row; revision.current = row.revision; setDraft(row); setSaved(true); }
      else await create();
    }).catch(e => setError(e instanceof Error ? e.message : "无法读取本机草稿。"));
    return () => { active = false; };
  }, [scope, enabled, reload, create]);
  useEffect(() => {
    let active = true;
    if (credentials && enabled) void requestMobileJson(credentials, "/api/mobile/v1/drafts").then(body => {
      const rows = (body as { drafts: Draft[] }).drafts;
      if (!Array.isArray(rows)) return;
      for (const row of rows) parseDraftContent(row);
      if (active) setServerState({ scope, drafts: rows });
    }).catch(() => {});
    return () => { active = false; };
  }, [credentials, scope, enabled]);
  const change = useCallback((patch: Partial<DraftContent>) => {
    const row = current.current;
    if (!row || row.status !== "editing") return;
    void write({ ...row, content: { ...row.content, ...patch }, revision: row.revision + 1, mutationId: Crypto.randomUUID(), updatedAt: new Date().toISOString() }).catch(() => {});
  }, [write]);
  const addOriginals = useCallback(async (originals: (DraftOriginal & { existing?: boolean; item?: Pick<DraftItem, "id" | "livePhotoGroupId" | "livePhotoRole"> })[], destination?: { scope: string; id: string }) => {
    const row = current.current;
    if (!row || row.status !== "editing") throw new Error("请先打开可以编辑的草稿。");
    if (destination && (destination.scope !== row.scope || destination.id !== row.id)) throw new Error("连接或草稿已切换；原件保留在原账号的恢复草稿中。");
    const items = originals.map(o => ({ id: o.item?.id ?? Crypto.randomUUID(), ...o.item, assetId: null, localCaptureRef: o.id, caption: "" }));
    try {
      await write({ ...row, content: { ...row.content, coverItemId: row.content.coverItemId ?? items[0]?.id ?? null, items: [...row.content.items, ...items] }, revision: row.revision + 1, mutationId: Crypto.randomUUID(), updatedAt: new Date().toISOString() }, originals.filter(o => !o.existing));
    } catch (error) {
      const live = current.current;
      if (live) {
        const added = new Set(items.map(i => i.id));
        const next = { ...live, content: { ...live.content, items: live.content.items.filter(i => !added.has(i.id)), coverItemId: added.has(live.content.coverItemId ?? "") ? row.content.coverItemId : live.content.coverItemId } };
        current.current = next; setDraft(next);
      }
      throw error;
    }
  }, [write]);
  const addOriginal = useCallback((id: string, payload: MediaCapturePayload, existing = false) => addOriginals([{ id, payload, existing }]), [addOriginals]);
  const save = useCallback(async (publish: boolean, syncIntent?: "draft" | "review") => {
    await writes.current;
    const row = current.current;
    if (!row || failure.current) throw new Error("本机草稿尚未保存，请检查存储空间。");
    if ((publish || syncIntent) && row.content.items.some(i => i.preservationState === "missing")) throw new Error("有原件复制中断或缺失，请重新导入完整一组，或移除缺失的素材后保存。");
    if (publish && !isDraftDateComplete(row.content)) throw new Error("请先确认发生时间，或选择「不详」；也可以先保留草稿。");
    const next = { ...row, revision: row.revision + 1, status: publish || syncIntent ? "queued" as const : "editing" as const, syncIntent: publish ? "publish" as const : syncIntent };
    await write(next);
    if (publish || syncIntent) await queueDraftOriginals(next);
    await reload();
  }, [write, reload]);
  const resume = useCallback(async (row: LocalDraft) => { await writes.current; if (failure.current) return; current.current = row; revision.current = row.revision; setDraft(row); setSaved(true); }, []);
  const discard = useCallback(async () => {
    await writes.current;
    if (!current.current || failure.current) return;
    await write({ ...current.current, status: "discarded", discardPending: current.current.serverRevision > 0, revision: current.current.revision + 1 });
    await create();
  }, [write, create]);
  const reopen = useCallback(async () => {
    await writes.current;
    if (!current.current || failure.current || current.current.status !== "queued") return;
    await write({ ...current.current, status: "editing", revision: current.current.revision + 1 }); await reload();
  }, [write, reload]);
  const retry = useCallback(async () => { failure.current = false; if (current.current) await write(current.current); }, [write]);
  const bind = useCallback(async (id: string) => { await writes.current; const row = await bindLocalDraft(id, scope); await resume(row); await reload(); }, [scope, resume, reload]);
  const continueServer = useCallback(async (remote: Draft, isCurrent: () => boolean = () => true) => {
    await writes.current;
    if (!isCurrent()) return;
    if (remote.status !== "editing") throw new Error("这份草稿已提交或关闭，请刷新后核对。");
    if (failure.current) throw new Error("请先处理本机保存错误。");
    const existing = (await listLocalDrafts(scope)).find(d => d.id === remote.id);
    if (existing && existing.revision !== existing.syncedRevision) throw new Error("本机有未送达的修改，请先继续本机草稿，避免覆盖。");
    if (remote.items.some(item => !item.assetId)) throw new Error("这份草稿还有素材留在原设备，请先在那里完成上传。");
    const nextRevision = (existing?.revision ?? 0) + 1;
    const row: LocalDraft = { id: remote.id, scope, content: { ...parseDraftContent(remote), items: remote.items.map(item => ({ ...item, localCaptureRef: null })) }, status: "editing", revision: nextRevision, syncedRevision: nextRevision, serverRevision: remote.revision, mutationId: Crypto.randomUUID(), memoryEventId: null, updatedAt: remote.updatedAt };
    if (!isCurrent()) return;
    await saveLocalDraft(row, existing?.revision ?? 0);
    if (!isCurrent()) return;
    await resume(row); if (isCurrent()) await reload();
  }, [scope, resume, reload]);
  return { reopen, continueServer, serverDrafts: serverState.scope === scope ? serverState.drafts : [], bind, unboundDrafts, draft: draft?.scope === scope ? draft : null, drafts: drafts.filter(d => d.scope === scope), error, saved, change, addOriginal, addOriginals, save, create, resume, discard, retry, reload };
}
