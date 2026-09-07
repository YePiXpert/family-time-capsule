"use client";
/* eslint-disable @next/next/no-img-element -- Local preserved blobs must be previewed without uploading them to an image optimizer. */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { uploadDraftOriginal } from "@/lib/drafts/browser-upload";
import { emptyDraftContent, type Draft, type DraftContent } from "@/lib/drafts/model";
import { listBrowserDrafts, readBrowserOriginal, writeBrowserDraft, type BrowserDraft, type BrowserOriginal } from "@/lib/drafts/browser-store";
import { zonedWallTimeToUtc, utcToZonedWallTimeInput } from "@/lib/metadata/time";

type Person = { id: string; displayName: string; isChild: boolean };
const field = "min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2 text-base";
const button = "ui-button-secondary min-h-11";
function message(error: unknown) { return error instanceof Error ? error.message : "操作失败，请重试。"; }
async function requestDraft(id: string, path: string, body: unknown, method = "POST"): Promise<Draft> {
  const response = await fetch(`/api/mobile/v1/drafts/${id}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok) {
    const errors: Record<string, string> = { revision_conflict: "另一台设备已修改这份草稿，请核对服务器草稿；本机内容已保留。", originals_pending: "还有原件未送达，请稍后重试。", occurred_at_required: "请确认发生时间后再创建记忆。", private_publication_unavailable: "这份草稿仅自己可见，请先保留草稿。", forbidden: "当前账号权限已改变，内容仍保存在本机。", draft_closed: "服务器上的草稿已经完成或放弃，请核对后继续。" };
    throw new Error(errors[result.error] ?? "服务器未能接收，本机草稿仍在，可以重试。");
  }
  return result;
}

export function PersistentCaptureEditor({ people, canArchive, scope, timezone }: { people: Person[]; canArchive: boolean; scope: string; timezone: string }) {
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
    void store({ ...old, content: { ...old.content, ...patch }, revision: old.revision + 1, mutationId: crypto.randomUUID(), updatedAt: new Date().toISOString() }).catch(() => {});
  }, [store]);
  const create = useCallback(async () => {
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
      setDrafts(rows);
      const existing = rows.find(row => row.status === "editing" || row.status === "queued");
      if (existing) { current.current = existing; committed.current = existing.revision; setDraft(existing); setSaved(true); }
      else void create().catch(error => setDiskError(message(error)));
    }).catch(error => setDiskError(message(error)));
    void fetch("/api/mobile/v1/drafts").then(r => r.ok ? r.json() : null).then(body => { if (active && body) setServerDrafts(body.drafts); }).catch(() => {});
    return () => { active = false; mounted.current = false; recorder.current?.stop(); recordingStream.current?.getTracks().forEach(track => track.stop()); };
  }, [scope, create]);

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    void Promise.all((draft?.content.items ?? []).map(async item => {
      const original = item.localCaptureRef ? await readBrowserOriginal(scope, item.localCaptureRef) : undefined;
      if (original) { const url = URL.createObjectURL(original.file); urls.push(url); return [item.id, { url, type: original.file.type, name: original.file.name }] as const; }
      if (item.assetId) {
        try {
          const response = await fetch(`/api/media/${encodeURIComponent(item.assetId)}/metadata`);
          if (response.ok) { const asset = await response.json(); return [item.id, { url: `/api/media/${item.assetId}`, type: asset.mimeType as string, name: asset.filename as string }] as const; }
        } catch { /* Keep the reference; opening may work after reconnecting. */ }
      }
      return [item.id, { url: "", type: "", name: "素材尚未读取，请联网重试或核对读取权限" }] as const;
    })).then(rows => { if (active) setPreviews(Object.fromEntries(rows)); else urls.forEach(url => URL.revokeObjectURL(url)); }).catch(error => setDiskError(message(error)));
    return () => { active = false; urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [draft?.content.items, scope]);

  async function addFiles(files: File[]) {
    const old = current.current;
    if (!old || old.status !== "editing" || !files.length) return;
    if (old.content.items.length + files.length > 200) { setNotice("一件事最多添加 200 份素材；更多原件可以先留在资料库。"); return; }
    const originals = files.map(file => ({ scope, id: crypto.randomUUID(), file, assetId: null }));
    const items = originals.map(original => ({ id: crypto.randomUUID(), assetId: null, localCaptureRef: original.id, caption: "" }));
    try {
      await store({ ...old, content: { ...old.content, items: [...old.content.items, ...items], coverItemId: old.content.coverItemId ?? items[0]?.id ?? null }, revision: old.revision + 1, mutationId: crypto.randomUUID(), updatedAt: new Date().toISOString() }, originals);
      setNotice(`${files.length} 份原件已保存在本机，可继续补文字和录音。`);
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
            await store({ ...row, status: "published", memoryEventId: remote.memoryEventId, serverRevision: remote.revision, revision: row.revision + 1 });
            setNotice("正式记忆已经创建，已恢复确认结果。"); await refreshList(); return;
          }
        } else if (check.status !== 404) throw new Error("暂时无法核对保存结果，本机草稿仍保留。");
      }
      for (const item of row.content.items) {
        if (item.assetId || !item.localCaptureRef) continue;
        const original = await readBrowserOriginal(scope, item.localCaptureRef);
        if (!original) throw new Error("本机原件不可读，请保留草稿并检查存储空间。");
        if (row.content.visibility === "private") throw new Error("私密素材已留在本机，暂不上传；读者权限补齐后才能送往服务器。");
        const result = await uploadDraftOriginal(original.file, item.localCaptureRef);
        const assetId = result.assetId ?? result.existingAssetId;
        if (!assetId) throw new Error(result.message ?? "原件上传未完成，本机原件仍在。");
        const live = current.current!;
        const duplicate = live.content.items.find(i => i.id !== item.id && i.assetId === assetId);
        const items = duplicate ? live.content.items.filter(i => i.id !== item.id) : live.content.items.map(i => i.id === item.id ? { ...i, assetId } : i);
        const coverItemId = duplicate && live.content.coverItemId === item.id ? duplicate.id : live.content.coverItemId;
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
        const result = received.status === "published" ? received : await requestDraft(row.id, "/publish", { expectedRevision: received.revision });
        const latest = current.current!;
        await store({ ...latest, status: "published", memoryEventId: result.memoryEventId, serverRevision: result.revision, revision: latest.revision + 1, syncedRevision: latest.revision + 1 });
        setNotice("正式记忆已创建。AI 尚未整理，可以稍后再安排。");
      } else setNotice("服务器已收到草稿，可以换设备继续。尚未创建正式记忆。");
      await refreshList();
    } catch (error) { if (mounted.current) setNotice(message(error)); }
    finally { syncBusy.current = false; if (mounted.current) setSyncing(false); }
  }
  async function save(publish: boolean, review = false) {
    const row = current.current;
    if (!row) return;
    if (publish && !row.content.occurredAt) { setNotice("请确认发生时间后再创建记忆；也可以先保留草稿。"); return; }
    if (publish && row.content.visibility === "private") { setNotice("仅自己可见的内容可以先保留草稿。"); return; }
    try {
      await store({ ...row, status: publish ? "queued" : "editing", revision: row.revision + 1, mutationId: crypto.randomUUID(), updatedAt: new Date().toISOString() });
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
    const local: BrowserDraft = { id: row.id, scope, content: row, revision: (existing?.revision ?? 0) + 1, serverRevision: row.revision, syncedRevision: (existing?.revision ?? 0) + 1, mutationId: crypto.randomUUID(), status: "editing", memoryEventId: row.memoryEventId, updatedAt: row.updatedAt };
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
  return <div className="mt-8 space-y-6">
    <div className="flex flex-wrap gap-3"><button className={button} disabled={syncing || !!diskError} onClick={() => void create()}>新建一件事</button><Link href="/inbox" className={button}>整理以前收到的内容</Link></div>
    <details><summary className="min-h-11 cursor-pointer">继续草稿（{drafts.filter(d => d.status === "editing" || d.status === "queued").length}）</summary>
      {drafts.filter(d => d.status === "editing" || d.status === "queued").map(d => <button key={d.id} className={`${button} m-1`} onClick={() => void resume(d)}>{d.content.title || d.content.text.slice(0, 30) || "未命名的一件事"}</button>)}
      {serverDrafts.filter(d => !drafts.some(l => l.id === d.id)).map(d => <button key={d.id} className={`${button} m-1`} onClick={() => void continueServer(d).catch(e => setNotice(message(e)))}>{d.title || "服务器草稿"}</button>)}
    </details>
    <p role="status">{saved ? "本机已保存" : "正在写入本机…"} · {draft.serverRevision ? "服务器已收到" : "服务器尚未收到"} · {draft.status === "published" ? "正式记忆已创建" : "尚未创建正式记忆"} · AI 尚未整理</p>
    {diskError && <div role="alert" className="rounded-xl border border-red-700 p-4 text-red-800">{diskError}<button className={button} onClick={() => { failed.current = false; void store(current.current!).catch(() => {}); }}>重试本机保存</button></div>}
    {notice && <p role="status" className="rounded-xl bg-surface-muted p-4">{notice}</p>}
    {draft.memoryEventId && <Link href={`/memories/${draft.memoryEventId}`} className="ui-button-primary">查看这条记忆</Link>}
    <fieldset disabled={!editable} className="space-y-5">
      <label className="block">写下这一刻<textarea className={`${field} mt-2`} rows={6} maxLength={5000} value={content.text} onChange={e => change({ text: e.target.value })} placeholder="写一句话，也可以继续加照片和录音。" /></label>
      <div className="flex flex-wrap gap-3"><label className={`${button} cursor-pointer`}>添加照片、视频、录音或文档<input type="file" multiple className="sr-only" onChange={e => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} /></label><label className={`${button} cursor-pointer`}>拍照<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={e => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} /></label><button type="button" className="ui-button-primary min-h-12" onClick={() => void toggleRecording()}>{recording ? "停止录音并加入这件事" : "开始录音"}</button></div>
      <ol className="space-y-3">{content.items.map((item, index) => {
        const preview = previews[item.id];
        return <li key={item.id} className="rounded-xl border border-line p-4">
          {preview?.type.startsWith("image/") ? <img src={preview.url} alt={item.caption || "这件事的照片"} className="max-h-64 rounded-lg object-contain" /> : preview?.type.startsWith("audio/") ? <audio controls src={preview.url} aria-label="重听这段录音" /> : preview?.type.startsWith("video/") ? <video controls src={preview.url} className="max-h-64" /> : preview?.url ? <a href={preview.url} target="_blank" rel="noreferrer" className={button}>打开素材</a> : null}
          <p>{item.preservationState === "missing" ? "原件已移除，请删除这项引用或补充素材" : preview?.name || "正在读取原件"} · {item.assetId ? "服务器已收到原件" : "原件已在本机"}</p>
          <label>素材说明<input className={field} value={item.caption} maxLength={2000} onChange={e => change({ items: content.items.map(i => i.id === item.id ? { ...i, caption: e.target.value } : i) })} /></label>
          <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={button} disabled={index === 0} onClick={() => { const items = [...content.items]; [items[index - 1], items[index]] = [items[index]!, items[index - 1]!]; change({ items }); }}>上移</button><button type="button" className={button} disabled={index === content.items.length - 1} onClick={() => { const items = [...content.items]; [items[index], items[index + 1]] = [items[index + 1]!, items[index]!]; change({ items }); }}>下移</button><button type="button" className={button} onClick={() => change({ coverItemId: item.id })}>{content.coverItemId === item.id ? "已选为封面" : "设为封面"}</button><button type="button" className={button} onClick={() => change({ items: content.items.filter(i => i.id !== item.id), coverItemId: content.coverItemId === item.id ? null : content.coverItemId })}>从草稿移除</button></div>
        </li>;
      })}</ol>
      <label className="block">标题<input className={field} value={content.title} maxLength={100} onChange={e => change({ title: e.target.value })} /></label>
      <label className="block">发生时间<input type="datetime-local" className={field} value={content.occurredAt ? utcToZonedWallTimeInput(new Date(content.occurredAt), timezone).slice(0, 16) : ""} onChange={e => { try { change({ occurredAt: e.target.value ? zonedWallTimeToUtc(`${e.target.value}:00`, timezone).toISOString() : null }); } catch { setNotice("时间格式不正确。"); } }} /></label>
      <button type="button" className={button} onClick={() => change({ occurredAt: new Date().toISOString() })}>就是现在</button>
      <label className="block">地点<input className={field} value={content.locationText} maxLength={200} onChange={e => change({ locationText: e.target.value })} /></label>
      <fieldset><legend>人物</legend>{people.map(p => <label key={p.id} className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={content.participantIds.includes(p.id)} onChange={e => change({ participantIds: e.target.checked ? [...content.participantIds, p.id] : content.participantIds.filter(id => id !== p.id) })} />{p.displayName}</label>)}</fieldset>
      <label className="block">保存后的读者<select className={field} value={content.visibility} onChange={e => change({ visibility: e.target.value as DraftContent["visibility"] })}><option value="family">全家</option><option value="private">仅自己（先保留草稿）</option></select></label>
    </fieldset>
    <div className="flex flex-wrap gap-3"><button className={button} disabled={syncing || !!diskError || recording || draft.status === "published"} onClick={() => void save(false, true)}>先收进来，交给家人整理</button><button className={button} disabled={syncing || !!diskError || recording || draft.status === "published"} onClick={() => void save(false)}>保留草稿，稍后继续</button>{canArchive && <button className="ui-button-primary min-h-11" disabled={syncing || !!diskError || recording || draft.status === "published"} onClick={() => void save(true)}>{draft.status === "queued" ? "重试创建记忆" : "保存为一条记忆"}</button>}{draft.status === "queued" && <button className={button} disabled={syncing} onClick={() => void store({ ...draft, status: "editing", revision: draft.revision + 1 }).catch(() => {})}>继续编辑</button>}<button className={button} disabled={syncing || draft.status === "published"} onClick={() => void discard()}>放弃这份草稿</button></div>
  </div>;
}
