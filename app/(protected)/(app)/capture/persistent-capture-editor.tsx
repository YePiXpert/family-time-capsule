"use client";
import { removeDraftItem, reconcileDraftAsset, pairDraftItems } from "@/lib/drafts/model";
/* eslint-disable @next/next/no-img-element -- Local preserved blobs must be previewed without uploading them to an image optimizer. */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { OrganizerControl } from "@/components/organizer-control";
import { canInferCaptureTime, captureDateSummary, captureOrganizerAvailability, captureSavedMessage, type CaptureProcessing } from "@/mobile/src/drafts/capture";
import type { AiSettings } from "@/mobile/src/ai/types";
import { uploadDraftOriginal } from "@/lib/drafts/browser-upload";
import { emptyDraftContent, isDraftDateComplete, type Draft, type DraftContent } from "@/lib/drafts/model";
import { listBrowserDrafts, readBrowserOriginal, writeBrowserDraft, type BrowserDraft, type BrowserOriginal } from "@/lib/drafts/browser-store";
import { zonedWallTimeToUtc, utcToZonedWallTimeInput } from "@/lib/metadata/time";
import { anchorFromPrecisionInput, formatOccurredLabel, type OccurredAtPrecision } from "@/lib/metadata/precision";

type Person = { id: string; displayName: string; isChild: boolean };
const field = "min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2 text-base";
const button = "ui-button-secondary min-h-11";
function message(error: unknown) { return error instanceof Error ? error.message : "操作失败，请重试。"; }
async function requestDraft(id: string, path: string, body: unknown, method = "POST"): Promise<Draft & { processing?: CaptureProcessing }> {
  const response = await fetch(`/api/mobile/v1/drafts/${id}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok) {
    const errors: Record<string, string> = { revision_conflict: "另一台设备已修改这份草稿，请核对服务器草稿；本机内容已保留。", originals_pending: "还有原件未送达，请稍后重试。", occurred_at_required: "请确认发生时间后再创建记忆。", invalid_reader: "指定的成员已不在本家庭，请重新选择读者。", forbidden: "当前账号权限已改变，内容仍保存在本机。", draft_closed: "服务器上的草稿已经完成或放弃，请核对后继续。" };
    throw new Error(errors[result.error] ?? "服务器未能接收，本机草稿仍在，可以重试。");
  }
  return result;
}

export function PersistentCaptureEditor({ people, members, canArchive, scope, timezone, initialServerDraft, aiSettings = null }: { aiSettings?: AiSettings | null; people: Person[]; members: { id: string; name: string }[]; canArchive: boolean; scope: string; timezone: string; initialServerDraft?: Draft }) {
  const [draft, setDraft] = useState<BrowserDraft | null>(null);
  const [drafts, setDrafts] = useState<BrowserDraft[]>([]);
  const [serverDrafts, setServerDrafts] = useState<Draft[]>([]);
  const [notice, setNotice] = useState("");
  const [diskError, setDiskError] = useState("");
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [previews, setPreviews] = useState<Record<string, { url: string; type: string; name: string }>>({});
  const current = useRef<BrowserDraft | null>(null);
  const committed = useRef(0);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const failed = useRef(false);
  const pendingOriginals = useRef(new Map<string, BrowserOriginal>());
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingStream = useRef<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const syncBusy = useRef(false);
  const mounted = useRef(true);
  const refreshList = useCallback(async () => setDrafts(await listBrowserDrafts(scope)), [scope]);

  const store = useCallback((next: BrowserDraft, originals: BrowserOriginal[] = []) => {
    for (const original of originals) pendingOriginals.current.set(original.id, original);
    current.current = next;
    setDraft(next); setSaved(false);
    const run = writes.current.then(async () => {
      if (failed.current) throw new Error("本机保存尚未恢复，请点击重试本机保存。");
      const pending = [...pendingOriginals.current.values()];
      await writeBrowserDraft(next, committed.current, pending);
      for (const original of pending) pendingOriginals.current.delete(original.id);
      committed.current = next.revision;
      if (current.current?.revision === next.revision) setSaved(true);
      setDiskError("");
    });
    writes.current = run.catch(error => { failed.current = true; setDiskError(message(error)); });
    return run;
  }, []);
  const change = useCallback((patch: Partial<DraftContent>) => {
    const old = current.current;
    if (!old || old.status !== "editing") return;
    void store({ ...old, captureTimeEdited: old.captureTimeEdited || "occurredAt" in patch || "occurredAtPrecision" in patch, content: { ...old.content, ...patch }, revision: old.revision + 1, mutationId: crypto.randomUUID(), updatedAt: new Date().toISOString() }).catch(() => {});
  }, [store]);
  const create = useCallback(async () => {
    setNotice("");
    await writes.current;
    if (failed.current) return;
    const id = crypto.randomUUID();
    committed.current = 0;
    await store({ id, scope, content: emptyDraftContent(), revision: 1, serverRevision: 0, syncedRevision: 0, mutationId: crypto.randomUUID(), status: "editing", memoryEventId: null, updatedAt: new Date().toISOString() });
    await refreshList();
  }, [scope, store, refreshList]);

  useEffect(() => {
    let active = true; mounted.current = true;
    void listBrowserDrafts(scope).then(async rows => {
      // A draft may have been confirmed in Inbox/on another device since this page closed.
      // Reconcile only a fully acknowledged local snapshot; never replace unsent edits.
      for (const [index, row] of rows.entries()) {
        if (!active) return;
        if (!navigator.onLine || !row.serverRevision || row.revision !== row.syncedRevision || !["editing", "queued"].includes(row.status)) continue;
        try {
          const response = await fetch(`/api/mobile/v1/drafts/${row.id}`, { signal: AbortSignal.timeout(1500) });
          if (!response.ok) continue;
          const remote = await response.json() as Draft;
          if (remote.revision <= row.serverRevision) continue;
          const next: BrowserDraft = { ...row, content: remote, status: remote.status, memoryEventId: remote.memoryEventId, serverRevision: remote.revision, revision: row.revision + 1, syncedRevision: row.revision + 1 };
          await writeBrowserDraft(next, row.revision); rows[index] = next;
        } catch { /* Offline continuation retains the last durable local snapshot. */ }
      }
      if (!active) return;
      if (initialServerDraft) {
        const existing = rows.find(row => row.id === initialServerDraft.id);
        if (initialServerDraft.items.some(item => !item.assetId && !existing?.content.items.find(local => local.id === item.id)?.localCaptureRef)) {
          setNotice("这份草稿还有素材留在原设备，请先在那里完成上传。已收到的原件仍可从资料库打开。"); setDrafts(rows); return;
        }
        if (!existing || existing.revision === existing.syncedRevision) {
          const revision = (existing?.revision ?? 0) + 1;
          const row: BrowserDraft = { id: initialServerDraft.id, scope, content: { ...initialServerDraft, items: initialServerDraft.items.map(item => ({ ...item, localCaptureRef: existing?.content.items.find(i => i.id === item.id)?.localCaptureRef ?? null })) }, revision, serverRevision: initialServerDraft.revision, syncedRevision: revision, mutationId: crypto.randomUUID(), status: initialServerDraft.status, memoryEventId: initialServerDraft.memoryEventId, updatedAt: initialServerDraft.updatedAt };
          await writeBrowserDraft(row, existing?.revision ?? 0);
          current.current = row; committed.current = row.revision; setDraft(row); setSaved(true); await refreshList(); return;
        }
        current.current = existing; committed.current = existing.revision; setDraft(existing); setSaved(true);
        setNotice("这份草稿还有本机修改，请先核对后再同步。服务器新加入的资料引用仍保留。"); setDrafts(rows); return;
      }
      setDrafts(rows);
      const existing = rows.find(row => row.status === "editing" || row.status === "queued");
      if (existing) { current.current = existing; committed.current = existing.revision; setDraft(existing); setSaved(true); }
      else void create().catch(error => setDiskError(message(error)));
    }).catch(error => setDiskError(message(error)));
    void fetch("/api/mobile/v1/drafts").then(r => r.ok ? r.json() : null).then(body => { if (active && body) setServerDrafts(body.drafts); }).catch(() => {});
    return () => { active = false; mounted.current = false; recorder.current?.stop(); recordingStream.current?.getTracks().forEach(track => track.stop()); };
  }, [scope, create, initialServerDraft, refreshList]);

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    // Items render optimistically; their blobs are readable only after the
    // IndexedDB transaction commits. A successful retry must refresh previews too.
    void writes.current.then(async () => {
      if (!active || failed.current) return [];
      return Promise.all((draft?.content.items ?? []).map(async item => {
      const original = item.localCaptureRef ? await readBrowserOriginal(scope, item.localCaptureRef) : undefined;
      if (original) { const url = URL.createObjectURL(original.file); urls.push(url); return [item.id, { url, type: original.file.type, name: original.file.name }] as const; }
      if (item.assetId) {
        try {
          const response = await fetch(`/api/media/${encodeURIComponent(item.assetId)}/metadata`);
          if (response.ok) { const asset = await response.json(); return [item.id, { url: `/api/media/${item.assetId}`, type: asset.mimeType as string, name: asset.filename as string }] as const; }
        } catch { /* Keep the reference; opening may work after reconnecting. */ }
      }
      return [item.id, { url: "", type: "", name: "素材尚未读取，请联网重试或核对读取权限" }] as const;
      }));
    }).then(rows => { if (active) setPreviews(Object.fromEntries(rows)); else urls.forEach(url => URL.revokeObjectURL(url)); }).catch(error => { if (active) setDiskError(message(error)); });
    return () => { active = false; urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [draft?.content.items, scope, saved]);

  async function addFiles(files: File[]) {
    const old = current.current;
    if (!old || old.status !== "editing" || !files.length) return;
    if (old.content.items.length + files.length > 200) { setNotice("一件事最多添加 200 份素材；更多原件可以先留在资料库。"); return; }
    const originals = files.map(file => ({ scope, id: crypto.randomUUID(), file, assetId: null }));
    const items = originals.map(original => ({ id: crypto.randomUUID(), assetId: null, localCaptureRef: original.id, caption: "" }));
    try {
      await store({ ...old, content: { ...old.content, items: [...old.content.items, ...items], coverItemId: old.content.coverItemId ?? items[0]?.id ?? null }, revision: old.revision + 1, mutationId: crypto.randomUUID(), updatedAt: new Date().toISOString() }, originals);
      setNotice(`${files.length} 份原件已保存在本机。`);
    } catch (error) { setNotice(message(error)); }
  }
  async function toggleRecording() {
    try {
      if (recorder.current) { recorder.current.stop(); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); recordingStream.current = stream;
      const next = new MediaRecorder(stream), chunks: Blob[] = [];
      next.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      next.onstop = () => { stream.getTracks().forEach(t => t.stop()); recorder.current = null; setRecording(false); if (chunks.length) void addFiles([new File(chunks, `家庭录音.${next.mimeType.includes("mp4") ? "m4a" : "webm"}`, { type: next.mimeType })]); };
      next.onerror = () => { setNotice("录音发生错误，请重听并检查是否完整。"); stream.getTracks().forEach(t => t.stop()); };
      recorder.current = next; next.start(1000); setRecording(true);
    } catch (error) { setNotice(`无法录音：${message(error)}`); }
  }
  async function sendToServer(publish: boolean, review = false) {
    if (syncBusy.current) return;
    syncBusy.current = true; setSyncing(true);
    try {
      await writes.current;
      if (failed.current) throw new Error("请先处理本机保存错误。");
      let row = current.current!;
      if (row.status === "queued") {
        const check = await fetch(`/api/mobile/v1/drafts/${row.id}`, { signal: AbortSignal.timeout(30000) });
        if (check.ok) {
          const remote = await check.json() as Draft;
          if (remote.status === "published" && remote.memoryEventId) {
            await store({ ...row, content: { ...row.content, occurredAt: remote.occurredAt, occurredAtPrecision: remote.occurredAtPrecision }, status: "published", memoryEventId: remote.memoryEventId, serverRevision: remote.revision, revision: row.revision + 1 });
            setNotice("记忆已保存，已恢复上次结果。"); await refreshList(); return;
          }
        } else if (check.status !== 404) throw new Error("暂时无法核对保存结果，本机草稿仍保留。");
      }
      if (row.content.items.some(item => !item.assetId)) {
        const accepted = await requestDraft(row.id, "", { expectedRevision: row.serverRevision, mutationId: row.mutationId, content: row.content }, "PUT");
        const live = current.current!;
        await store({ ...live, serverRevision: accepted.revision, revision: live.revision + 1 });
        row = current.current!;
      }
      for (const item of row.content.items) {
        if (item.assetId || !item.localCaptureRef) continue;
        const original = await readBrowserOriginal(scope, item.localCaptureRef);
        if (!original) throw new Error("本机原件不可读，请保留草稿并检查存储空间。");
        const revision = current.current!.revision;
        const guard = () => { if (!mounted.current || current.current?.id !== row.id || current.current?.revision !== revision) throw new Error("草稿已修改或关闭，上传已暂停；原件仍保留。"); };
        const result = await uploadDraftOriginal(original.file, item.localCaptureRef, row.id, guard);
        guard();
        const assetId = result.assetId ?? result.existingAssetId;
        if (!assetId) throw new Error(result.message ?? "原件上传未完成，本机原件仍在。");
        const live = current.current!;
        const { items, coverItemId } = reconcileDraftAsset(live.content, item.id, assetId);
        await store({ ...live, content: { ...live.content, items, coverItemId }, revision: live.revision + 1, mutationId: crypto.randomUUID(), updatedAt: new Date().toISOString() });
      }
      row = current.current!;
      const received = await requestDraft(row.id, "", { expectedRevision: row.serverRevision, mutationId: row.mutationId, content: row.content }, "PUT");
      const live = current.current!;
      await store({ ...live, revision: live.revision + 1, serverRevision: received.revision, syncedRevision: live.revision === row.revision ? live.revision + 1 : row.revision });
      if (review) {
        const submitted = await requestDraft(row.id, "/submit", { expectedRevision: received.revision });
        const latest = current.current!;
        await store({ ...latest, revision: latest.revision + 1, serverRevision: submitted.revision, syncedRevision: latest.revision + 1 });
        setNotice("已收进收件箱。整件事的草稿可以继续整理。");
      } else if (publish) {
        const result = received.status === "published" ? received : await requestDraft(row.id, "/publish", { expectedRevision: received.revision, quickSave: true, inferTime: !row.captureTimeEdited, organize: row.organizeOnPublish === true });
        const latest = current.current!;
        await store({ ...latest, content: { ...latest.content, occurredAt: result.occurredAt, occurredAtPrecision: result.occurredAtPrecision }, processing: result.processing, status: "published", memoryEventId: result.memoryEventId, serverRevision: result.revision, revision: latest.revision + 1, syncedRevision: latest.revision + 1 });
        setNotice(captureSavedMessage(result.processing));
      } else setNotice("服务器已收到草稿，可以换设备继续。尚未创建正式记忆。");
      await refreshList();
    } catch (error) { if (mounted.current) setNotice(message(error)); }
    finally { syncBusy.current = false; if (mounted.current) setSyncing(false); }
  }
  async function save(publish: boolean, review = false, organize = false) {
    setNotice("");
    const row = current.current;
    if (!row) return;
    if (publish && !isDraftDateComplete(row.content) && (!canInferCaptureTime(row.content) || row.captureTimeEdited)) { setNotice("请确认发生时间，或选择「时间记不得了」；也可以先保留草稿。"); return; }
    if (publish && row.content.visibility === "members" && row.content.readerUserIds.length === 0) { setNotice("请先选择可以阅读这件事的家人，或改回全家/仅自己。"); return; }
    try {
      await store({ ...row, organizeOnPublish: publish && organize, status: publish ? "queued" : "editing", revision: row.revision + 1, mutationId: crypto.randomUUID(), updatedAt: new Date().toISOString() });
      setNotice(publish ? "本机已保存，正在后台创建记忆。可以离开页面，重开后可继续。" : "本机已保存，正在尝试送往服务器。可以离开页面。");
      void sendToServer(publish, review);
    } catch (error) { setNotice(message(error)); }
  }
  async function resume(row: BrowserDraft) {
    await writes.current; if (failed.current || syncing) return;
    current.current = row; committed.current = row.revision; setDraft(row); setSaved(true); setNotice("");
  }
  async function continueServer(row: Draft) {
    await writes.current;
    if (syncing || failed.current) return;
    const existing = (await listBrowserDrafts(scope)).find(d => d.id === row.id);
    if (existing && existing.revision !== existing.syncedRevision) { setNotice("本机还有未送达的修改，请先继续本机草稿，避免覆盖。"); return; }
    if (row.status !== "editing") throw new Error("这份草稿已提交或关闭，请刷新后核对。");
    if (row.items.some(item => !item.assetId)) throw new Error("这份草稿还有素材留在原设备，请先在那里完成上传。");
    const local: BrowserDraft = { id: row.id, scope, content: { ...row, items: row.items.map(item => ({ ...item, localCaptureRef: null })) }, revision: (existing?.revision ?? 0) + 1, serverRevision: row.revision, syncedRevision: (existing?.revision ?? 0) + 1, mutationId: crypto.randomUUID(), status: "editing", memoryEventId: row.memoryEventId, updatedAt: row.updatedAt };
    await writeBrowserDraft(local, existing?.revision ?? 0); await resume(local); await refreshList();
  }
  async function discard() {
    const row = current.current; if (!row || syncing) return;
    try {
      await writes.current;
      if (row.serverRevision > 0) await requestDraft(row.id, "", { expectedRevision: row.serverRevision }, "DELETE");
      await store({ ...row, status: "discarded", revision: row.revision + 1 });
      setNotice("草稿已放弃，原件仍保留。"); await create();
    } catch (error) { setNotice(message(error)); }
  }
  if (!draft) return <p role="status" className="mt-8">{diskError || "正在打开本机草稿…"}</p>;
  const content = draft.content, editable = draft.status === "editing" && !syncing;
  const organizer = captureOrganizerAvailability(aiSettings, content.visibility, content.items.map(item => previews[item.id]?.type ?? ""));
  const occurredInput = () => {
    if (!content.occurredAt) return "";
    const wall = utcToZonedWallTimeInput(new Date(content.occurredAt), timezone);
    if (content.occurredAtPrecision === "month") return wall.slice(0, 7);
    if (content.occurredAtPrecision === "year") return wall.slice(0, 4);
    if (content.occurredAtPrecision === "date_only") return wall.slice(0, 10);
    return wall.slice(0, 16);
  };
  const setOccurredInput = (value: string) => {
    try {
      const anchor = anchorFromPrecisionInput({ precision: content.occurredAtPrecision, wall: value, timezone, toUtc: zonedWallTimeToUtc });
      change({ occurredAt: anchor ? anchor.toISOString() : null });
    } catch { setNotice("时间格式不正确。"); }
  };
  return <div className="mt-6 space-y-4 pb-20 sm:pb-0">
    <p role="status">{saved ? "本机已保存" : "正在写入本机…"} · {draft.status === "published" ? "记忆已保存" : draft.serverRevision ? "草稿已同步" : "等待发送"}</p>
    {diskError && <div role="alert" className="rounded-xl border border-red-700 p-4 text-red-800">{diskError}<button className={button} onClick={() => { failed.current = false; void store(current.current!).catch(() => {}); }}>重试本机保存</button></div>}
    {notice && <p role="status" className="text-sm text-ink-muted">{notice}</p>}
    {draft.memoryEventId && draft.organizeOnPublish && <OrganizerControl kind="memory_event" id={draft.memoryEventId} defaultOpen />}
    {draft.memoryEventId && <div className="flex flex-wrap gap-3"><Link href={`/memories/${draft.memoryEventId}`} className="ui-button-primary">查看这条记忆</Link><button className={button} disabled={syncing || recording || !!diskError} onClick={() => void create()}>新建一件事</button></div>}
    <fieldset disabled={!editable} className="space-y-5">
      <div className="flex flex-wrap gap-3"><label className={`${button} cursor-pointer`}>选择素材<input aria-label="添加照片、视频、录音或文档" type="file" multiple className="sr-only" onChange={e => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} /></label><label className={`${button} cursor-pointer`}>拍照<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={e => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} /></label><button type="button" className={`${button} min-h-11`} onClick={() => void toggleRecording()}>{recording ? "停止录音并加入这件事" : "开始录音"}</button></div>
      <label className="block">补充一句话（可选）<textarea aria-label="写下这一刻" className={`${field} mt-2`} rows={2} maxLength={5000} value={content.text} onChange={e => change({ text: e.target.value })} placeholder="想说点什么？也可以不写，直接保存素材。" /></label>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{content.items.map((item, index) => {
        const preview = previews[item.id], previous = content.items[index - 1];
        const canPair = previous && !previous.livePhotoGroupId && !item.livePhotoGroupId && previews[previous.id]?.type.startsWith("image/") && preview?.type.startsWith("video/");
        return <li key={item.id} className="rounded-xl border border-line p-4">
          {preview?.type.startsWith("image/") ? <img src={preview.url} alt={item.caption || "这件事的照片"} className="h-40 w-full rounded-lg object-contain" /> : preview?.type.startsWith("audio/") ? <audio controls src={preview.url} aria-label="重听这段录音" /> : preview?.type.startsWith("video/") ? <video controls src={preview.url} className="max-h-64" /> : preview?.url ? <a href={preview.url} target="_blank" rel="noreferrer" className={button}>打开素材</a> : null}
          <p>{item.preservationState === "missing" ? "原件已移除，请删除这项引用或补充素材" : preview?.name || "正在读取原件"} · {item.assetId ? "服务器已收到原件" : "原件已在本机"}</p>
          {item.livePhotoGroupId && <p>Live Photo · {item.livePhotoRole === "image" ? "静态照片" : "动态原片"}（移除时整组操作）</p>}
          {canPair && <button type="button" className={button} onClick={() => change(pairDraftItems(content, previous.id, item.id, crypto.randomUUID()))}>确认与上一张照片组成 Live Photo</button>}
          <details><summary className="min-h-11 cursor-pointer py-2">说明与调整（可选）</summary><label>素材说明<input className={field} value={item.caption} maxLength={2000} onChange={e => change({ items: content.items.map(i => i.id === item.id ? { ...i, caption: e.target.value } : i) })} /></label>
          <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={button} disabled={index === 0} onClick={() => { const items = [...content.items]; [items[index - 1], items[index]] = [items[index]!, items[index - 1]!]; change({ items }); }}>上移</button><button type="button" className={button} disabled={index === content.items.length - 1} onClick={() => { const items = [...content.items]; [items[index], items[index + 1]] = [items[index + 1]!, items[index]!]; change({ items }); }}>下移</button><button type="button" className={button} onClick={() => change({ coverItemId: item.id })}>{content.coverItemId === item.id ? "已选为封面" : "设为封面"}</button><button type="button" className={button} onClick={() => change(removeDraftItem(content, item.id))}>从草稿移除</button></div></details>
        </li>;
      })}</ol>
      <details className="rounded-xl border border-line p-4"><summary className="min-h-11 cursor-pointer py-2">补充信息（可选）</summary><div className="space-y-4">
      <label className="block">标题<input className={field} value={content.title} maxLength={100} onChange={e => change({ title: e.target.value })} /></label>
      <div className="block space-y-2">
        <label className="block">时间记得多清楚<select className={field} value={content.occurredAtPrecision} onChange={e => change({ occurredAtPrecision: e.target.value as OccurredAtPrecision, ...(e.target.value === "unknown" ? { occurredAt: null } : {}) })}><option value="exact">精确到分</option><option value="approximate">大致时间</option><option value="date_only">只记得日期</option><option value="month">只记得年月</option><option value="year">只记得年份</option><option value="unknown">时间记不得了</option></select></label>
        {content.occurredAtPrecision !== "unknown" && <label className="block">{content.occurredAtPrecision === "month" ? "年月（如 1988-05）" : content.occurredAtPrecision === "year" ? "年份（如 1988）" : "发生时间"}<input type={content.occurredAtPrecision === "month" ? "month" : content.occurredAtPrecision === "year" ? "text" : "datetime-local"} inputMode={content.occurredAtPrecision === "year" ? "numeric" : undefined} placeholder={content.occurredAtPrecision === "year" ? "1988" : undefined} className={field} value={occurredInput()} onChange={e => setOccurredInput(e.target.value)} /></label>}
        {content.occurredAtPrecision === "exact" && <button type="button" className={button} onClick={() => change({ occurredAt: new Date().toISOString() })}>就是现在</button>}
        <p className="text-sm text-ink-muted">{content.occurredAtPrecision === "unknown" ? "不填时间也照常保存；这条记忆会标注「时间不确定」，不会被放进某个编造的日期。" : content.occurredAt && content.occurredAtPrecision !== "exact" && content.occurredAtPrecision !== "approximate" ? formatOccurredLabel(content.occurredAtPrecision, content.occurredAt, timezone) : ""}</p>
      </div>
      <label className="block">地点<input className={field} value={content.locationText} maxLength={200} onChange={e => change({ locationText: e.target.value })} /></label>
      <fieldset><legend>人物</legend>{people.map(p => <label key={p.id} className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={content.participantIds.includes(p.id)} onChange={e => change({ participantIds: e.target.checked ? [...content.participantIds, p.id] : content.participantIds.filter(id => id !== p.id) })} />{p.displayName}</label>)}</fieldset>
      </div></details>
      <p className="text-sm text-ink-muted">{captureDateSummary(content, draft.captureTimeEdited, timezone)}</p>
      <label className="block">保存后的读者<select className={field} value={content.visibility} onChange={e => change({ visibility: e.target.value as DraftContent["visibility"], ...(e.target.value === "members" ? {} : { readerUserIds: [] }) })}><option value="family">全家</option><option value="members">指定成员</option><option value="private">仅自己</option></select></label>
      {content.visibility === "members" && <fieldset><legend>可以阅读的登录成员（始终包含自己）</legend>{members.map(m => <label key={m.id} className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={content.readerUserIds.includes(m.id)} onChange={e => change({ readerUserIds: e.target.checked ? [...content.readerUserIds, m.id] : content.readerUserIds.filter(id => id !== m.id) })} />{m.name}</label>)}
        {content.readerUserIds.filter(id => !members.some(m => m.id === id)).map(id => <label key={id} className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked onChange={() => change({ readerUserIds: content.readerUserIds.filter(readerId => readerId !== id) })} />已选成员（待联网核对，点按移除）</label>)}
      </fieldset>}
      {content.visibility !== "family" && <p className="text-sm text-ink-muted">草稿文字和新素材在发布前仅自己可见，发布后按这里选择的读者开放。原本已全家共享的素材不会因此收回旧共享。</p>}
    </fieldset>
    {draft.status !== "published" && <div className="space-y-3">
      {canArchive && <p className="text-sm text-ink-muted">{organizer.message} <Link href="/settings/ai" className="underline">AI 设置</Link></p>}
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex items-center gap-3 border-t border-line bg-surface px-4 py-3 sm:static sm:border-0 sm:bg-transparent sm:p-0"><span className="shrink-0 text-sm text-muted sm:hidden">{content.visibility === "family" ? "全家可见" : content.visibility === "members" ? "指定成员可见" : "仅自己可见"}</span>
      <button className="ui-button-primary min-h-12 w-full sm:w-auto" disabled={syncing || !!diskError || recording || (!content.text.trim() && !content.items.length)} onClick={() => void save(canArchive, !canArchive && content.visibility === "family", canArchive && (draft.status === "queued" ? draft.organizeOnPublish === true : organizer.ready))}>{syncing ? "正在保存…" : draft.status === "queued" ? draft.organizeOnPublish ? "重试保存并整理" : "重试保存" : canArchive && organizer.ready ? "保存并整理" : "保存"}</button></div>
      {!canArchive && <p className="text-sm text-ink-muted">{content.visibility === "family" ? "保存到家庭待整理列表，家人可以继续补充。" : "先保存为私密草稿，稍后可以继续。"}</p>}
      <details><summary className="min-h-11 cursor-pointer py-2">更多保存选项</summary>
    <details><summary className="min-h-11 cursor-pointer">继续草稿（{drafts.filter(d => d.id !== draft.id && (d.status === "editing" || d.status === "queued")).length}）</summary>
      {drafts.filter(d => d.id !== draft.id && (d.status === "editing" || d.status === "queued")).map(d => <button key={d.id} className={`${button} m-1`} disabled={syncing || recording} onClick={() => void resume(d)}>{d.content.title || d.content.text.slice(0, 30) || "未命名的一件事"}</button>)}
      {serverDrafts.filter(d => !drafts.some(l => l.id === d.id)).map(d => <button key={d.id} className={`${button} m-1`} disabled={syncing || recording} onClick={() => void continueServer(d).catch(e => setNotice(message(e)))}>{d.title || "服务器草稿"}</button>)}
    </details>
<div className="flex flex-wrap gap-3">
        <button className={button} disabled={syncing || recording || !!diskError} onClick={() => void create()}>新建一件事</button><Link href="/inbox" className={button}>整理以前收到的内容</Link><Link href="/imports" className={button}>批量导入</Link>
        {canArchive && <button className={button} disabled={syncing || !!diskError || recording} onClick={() => void save(true)}>仅保存，稍后整理</button>}
        <button className={button} disabled={syncing || !!diskError || recording} onClick={() => void save(false)}>保留草稿，稍后继续</button>
        {content.visibility === "family" && <button className={button} disabled={syncing || !!diskError || recording} onClick={() => void save(false, true)}>先收进来，交给家人整理</button>}
        {draft.status === "queued" && <button className={button} disabled={syncing} onClick={() => void store({ ...draft, status: "editing", revision: draft.revision + 1 }).catch(() => {})}>继续编辑</button>}
        <button className={button} disabled={syncing} onClick={() => void discard()}>放弃这份草稿</button>
      </div></details>
    </div>}
  </div>;
}
