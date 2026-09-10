"use client";
import styles from "./capture.module.css";
import { Icon } from "@/components/ui/icons";
import { RecordingMeter } from "@/components/recording-meter";
import { ImportedVideoPreview } from "@/components/imported-video-preview";
import { classifyImportedFile } from "@/mobile/src/storage/import-policy";
import { removeDraftItem, reconcileDraftAsset, pairDraftItems } from "@/lib/drafts/model";
/* eslint-disable @next/next/no-img-element -- Local preserved blobs must be previewed without uploading them to an image optimizer. */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { OrganizerControl } from "@/components/organizer-control";
import { canInferCaptureTime, captureDateSummary, captureOrganizerAvailability, captureSavedMessage, quickCaptureContent, type CaptureProcessing } from "@/mobile/src/drafts/capture";
import type { AiSettings } from "@/mobile/src/ai/types";
import { uploadDraftOriginal, type DraftUploadProgress } from "@/lib/drafts/browser-upload";
import { emptyDraftContent, isDraftDateComplete, type Draft, type DraftContent } from "@/lib/drafts/model";
import { listBrowserDrafts, readBrowserOriginal, writeBrowserDraft, type BrowserDraft, type BrowserOriginal } from "@/lib/drafts/browser-store";

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

export function PersistentCaptureEditor({ members, canArchive, scope, timezone, initialServerDraft, initialLocalDraftId, aiSettings = null }: { aiSettings?: AiSettings | null; members: { id: string; name: string }[]; canArchive: boolean; scope: string; timezone: string; initialServerDraft?: Draft; initialLocalDraftId?: string }) {
  const [draft, setDraft] = useState<BrowserDraft | null>(null);
  const [lastMemoryId, setLastMemoryId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [diskError, setDiskError] = useState("");
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [uploadProgress, setUploadProgress] = useState<(DraftUploadProgress & { filename: string }) | null>(null);
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
  const saveBusy = useRef(false);
  const mounted = useRef(true);

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
    setNotice(""); setSaveError(""); setUploadProgress(null);
    await writes.current;
    if (failed.current) return;
    const id = crypto.randomUUID();
    const previous = (current.current?.scope === scope ? current.current.content : undefined) ?? (await listBrowserDrafts(scope))[0]?.content;
    const content = { ...emptyDraftContent(), ...(previous ? { visibility: previous.visibility, readerUserIds: previous.readerUserIds } : {}) };
    committed.current = 0;
    await store({ id, scope, content, revision: 1, serverRevision: 0, syncedRevision: 0, mutationId: crypto.randomUUID(), status: "editing", memoryEventId: null, updatedAt: new Date().toISOString() });
  }, [scope, store]);

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
          setNotice("这份草稿还有素材留在原设备，请先在那里完成上传。已收到的原件仍可从资料库打开。"); return;
        }
        if (!existing || existing.revision === existing.syncedRevision) {
          const revision = (existing?.revision ?? 0) + 1;
          const row: BrowserDraft = { id: initialServerDraft.id, scope, content: { ...initialServerDraft, items: initialServerDraft.items.map(item => ({ ...item, localCaptureRef: existing?.content.items.find(i => i.id === item.id)?.localCaptureRef ?? null })) }, revision, serverRevision: initialServerDraft.revision, syncedRevision: revision, mutationId: crypto.randomUUID(), status: initialServerDraft.status, memoryEventId: initialServerDraft.memoryEventId, updatedAt: initialServerDraft.updatedAt };
          await writeBrowserDraft(row, existing?.revision ?? 0);
          current.current = row; committed.current = row.revision; setDraft(row); setSaved(true); return;
        }
        current.current = existing; committed.current = existing.revision; setDraft(existing); setSaved(true);
        setNotice("这份草稿还有本机修改，请先核对后再同步。服务器新加入的资料引用仍保留。"); return;
      }

      const existing = rows.find(row => row.id === initialLocalDraftId && (row.status === "editing" || row.status === "queued")) ?? rows.find(row => row.status === "editing" || row.status === "queued");
      if (existing) { current.current = existing; committed.current = existing.revision; setDraft(existing); setSaved(true); }
      else void create().catch(error => setDiskError(message(error)));
    }).catch(error => setDiskError(message(error)));
    return () => { active = false; mounted.current = false; recorder.current?.stop(); recordingStream.current?.getTracks().forEach(track => track.stop()); };
  }, [scope, create, initialServerDraft, initialLocalDraftId]);

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    // Items render optimistically; their blobs are readable only after the
    // IndexedDB transaction commits. A successful retry must refresh previews too.
    void writes.current.then(async () => {
      if (!active || failed.current) return [];
      return Promise.all((draft?.content.items ?? []).map(async item => {
      const original = item.localCaptureRef ? await readBrowserOriginal(scope, item.localCaptureRef) : undefined;
      if (original) { const url = URL.createObjectURL(original.file); urls.push(url); return [item.id, { url, type: classifyImportedFile(original.file.name, original.file.type)?.mimeType || original.file.type, name: original.file.name }] as const; }
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
            setLastMemoryId(remote.memoryEventId); await create(); setNotice("记忆已保存，已恢复上次结果。"); return;
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
        const result = await uploadDraftOriginal(original.file, item.localCaptureRef, row.id, guard, progress => {
          if (mounted.current) setUploadProgress({ ...progress, filename: original.file.name });
        });
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
        await create();
        setNotice("已收进收件箱，可以继续记录。");
      } else if (publish) {
        const result = received.status === "published" ? received : await requestDraft(row.id, "/publish", { expectedRevision: received.revision, quickSave: true, inferTime: !row.captureTimeEdited, organize: row.organizeOnPublish === true, organizeMode: "automatic" });
        const latest = current.current!;
        await store({ ...latest, content: { ...latest.content, occurredAt: result.occurredAt, occurredAtPrecision: result.occurredAtPrecision }, processing: result.processing, status: "published", memoryEventId: result.memoryEventId, serverRevision: result.revision, revision: latest.revision + 1, syncedRevision: latest.revision + 1 });
        setLastMemoryId(result.memoryEventId);
        await create();
        setNotice(captureSavedMessage(result.processing));
      } else {
        await create();
        setNotice("私密草稿已保存，可从未完成记录继续。");
      }
    } catch (error) { if (mounted.current) { setSaveError(message(error)); setNotice(""); } }
    finally { syncBusy.current = false; if (mounted.current) { setSyncing(false); setUploadProgress(null); } }
  }
  async function save(publish: boolean, review = false, organize = false) {
    if (saveBusy.current || syncBusy.current) return;
    setNotice(""); setSaveError(""); setUploadProgress(null);
    const row = current.current;
    if (!row) return;
    if (publish && !isDraftDateComplete(row.content) && (!canInferCaptureTime(row.content) || row.captureTimeEdited)) { setSaveError("这份旧草稿的日期尚未填完，可以标为时间不确定后保存。"); return; }
    if (publish && row.content.visibility === "members" && row.content.readerUserIds.length === 0) { setSaveError("请先选择可以阅读这件事的家人，或改回全家/仅自己。"); return; }
    saveBusy.current = true; setSyncing(true); setLastMemoryId(null);
    try {
      await store({ ...row, content: quickCaptureContent(row.content, row.captureTimeEdited), organizeOnPublish: publish && organize, status: publish ? "queued" : "editing", revision: row.revision + 1, mutationId: crypto.randomUUID(), updatedAt: new Date().toISOString() });
      setNotice(publish ? "本机已保存，正在后台创建记忆。可以离开页面，重开后可继续。" : "本机已保存，正在尝试送往服务器。可以离开页面。");
      await sendToServer(publish, review);
    } catch (error) { setSaveError(message(error)); setNotice(""); }
    finally { saveBusy.current = false; if (mounted.current) setSyncing(false); }
  }
  async function discard() {
    const row = current.current; if (!row || syncing || recording || !window.confirm("清空这次记录？原件仍会保留。")) return;
    try {
      await writes.current;
      if (row.serverRevision > 0) await requestDraft(row.id, "", { expectedRevision: row.serverRevision }, "DELETE");
      await store({ ...row, status: "discarded", revision: row.revision + 1 });
      await create(); setNotice("已清空，原件仍保留。");
    } catch (error) { setNotice(message(error)); }
  }
  if (!draft) return <div className="mt-8"><p role="status">{diskError || notice || "正在打开本机草稿…"}</p>{notice && <Link href="/pending" className={button}>返回未完成记录</Link>}</div>;
  const content = draft.content, editable = draft.status === "editing" && !syncing;
  const automaticRequested = captureOrganizerAvailability(aiSettings, content.visibility, [], "automatic").ready;
  const uploadPercent = uploadProgress ? Math.floor(uploadProgress.uploadedBytes / Math.max(1, uploadProgress.totalBytes) * 100) : 0;
  return <div className={styles.editor}>
    <div className={styles.paper}>
      {diskError && <div role="alert" className="inline-notice inline-notice-danger">{diskError}<button className={button} onClick={() => { failed.current = false; void store(current.current!).catch(() => {}); }}>重试本机保存</button></div>}
      <fieldset disabled={!editable} className={styles.compose}>
        <textarea aria-label="写下这一刻" className={styles.textarea} rows={5} maxLength={5000} value={content.text} onChange={e => change({ text: e.target.value })} placeholder="今天，有什么想记住的？" />
        <div className={styles.mediaTools}>
          <label className={styles.addMedia}><Icon name="image" size={20} />照片 / 视频<input aria-label="添加照片、视频、录音或文档" type="file" multiple className="sr-only" onChange={e => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} /></label>
          <div className={styles.tools}>
            <label className={styles.tool}><Icon name="camera" size={18} />拍照<input aria-label="拍照" type="file" accept="image/*" capture="environment" className="sr-only" onChange={e => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} /></label>
            <label className={styles.tool}><Icon name="video" size={18} />录像<input aria-label="录像" type="file" accept="video/*" capture="environment" className="sr-only" onChange={e => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} /></label>
            <button type="button" className={styles.tool} onClick={() => void toggleRecording()}><Icon name="microphone" size={18} />{recording ? "完成录音" : "录音"}</button>
            <label className={styles.tool}><Icon name="story" size={18} />文件<input aria-label="添加文件" type="file" multiple className="sr-only" onChange={e => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} /></label>
          </div>
        </div>
        <ol className={styles.attachments}>{content.items.map((item, index) => {
          const preview = previews[item.id], previous = content.items[index - 1];
          const canPair = previous && !previous.livePhotoGroupId && !item.livePhotoGroupId && previews[previous.id]?.type.startsWith("image/") && preview?.type.startsWith("video/");
          return <li key={item.id} className={styles.attachment}>
            {preview?.type.startsWith("image/") ? <img src={preview.url} alt={item.caption || "这件事的照片"} className={styles.preview} /> : preview?.type.startsWith("audio/") ? <audio controls src={preview.url} aria-label="重听这段录音" /> : preview?.type.startsWith("video/") ? <ImportedVideoPreview key={preview.url} src={preview.url} assetId={item.assetId} /> : preview?.url ? <a href={preview.url} target="_blank" rel="noreferrer" className={button}>打开素材</a> : null}
            <p className={styles.fileCaption}>{item.preservationState === "missing" ? "原件已移除，请移除这项引用或重新添加" : preview?.name || "正在读取原件"}</p>
            {item.livePhotoGroupId && <p className={styles.fileCaption}>Live Photo · {item.livePhotoRole === "image" ? "照片" : "动态原片"}</p>}
            {canPair && <button type="button" className={styles.tool} onClick={() => change(pairDraftItems(content, previous.id, item.id, crypto.randomUUID()))}>确认与上一张照片组成 Live Photo</button>}
            <button type="button" className={styles.tool} onClick={() => change(removeDraftItem(content, item.id))}>移除</button>
          </li>;
        })}</ol>
        {recording ? <RecordingMeter streamRef={recordingStream} /> : null}
      </fieldset>
      <div className={styles.paperFooter}>
        <p role="status" className={styles.saveState}>{saved ? "本机已保存" : "正在写入本机…"} · {draft.status === "queued" ? "待同步" : "自动暂存"}</p>
        {(content.text.trim() || content.items.length > 0 || content.title) && <button className={styles.tool} disabled={!editable || recording || !!diskError} onClick={() => void discard()}>清空</button>}
      </div>
    </div>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {lastMemoryId && <Link href={`/memories/${lastMemoryId}`} className={styles.resultLink}>查看这条记忆</Link>}
    {draft.memoryEventId && <><Link href={`/memories/${draft.memoryEventId}`} className={styles.resultLink}>查看这条记忆</Link><button className={styles.tool} onClick={() => void create()}>记录下一刻</button></>}
    {draft.memoryEventId && draft.organizeOnPublish && <OrganizerControl kind="memory_event" id={draft.memoryEventId} />}
    <p className={styles.dateNote}>{captureDateSummary(content, draft.captureTimeEdited, timezone)}</p>
    {!isDraftDateComplete(content) && (!canInferCaptureTime(content) || draft.captureTimeEdited) && <button className={styles.tool} disabled={!editable} onClick={() => change({ occurredAt: null, occurredAtPrecision: "unknown" })}>标为时间不确定</button>}
    {draft.status !== "published" && <>
      <fieldset disabled={!editable} className={styles.audience} aria-label="保存后的读者">
        <legend className="sr-only">保存后的读者</legend>
        {([["family", "全家"], ["members", "指定成员"], ["private", "仅自己"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={content.visibility === value} className={styles.audienceChoice} onClick={() => change({ visibility: value, ...(value === "members" ? {} : { readerUserIds: [] }) })}>{label}</button>)}
        {content.visibility === "members" && <div className={styles.members}>
          {members.map(m => <label key={m.id}><input type="checkbox" checked={content.readerUserIds.includes(m.id)} onChange={e => change({ readerUserIds: e.target.checked ? [...content.readerUserIds, m.id] : content.readerUserIds.filter(id => id !== m.id) })} />{m.name}</label>)}
          {content.readerUserIds.filter(id => !members.some(m => m.id === id)).map(id => <label key={id}><input type="checkbox" checked onChange={() => change({ readerUserIds: content.readerUserIds.filter(readerId => readerId !== id) })} />已选成员（待联网核对，点按移除）</label>)}
        </div>}
      </fieldset>
      {draft.status === "queued" && <button className={styles.tool} disabled={syncing} onClick={() => void store({ ...draft, status: "editing", revision: draft.revision + 1 }).catch(() => {})}>继续编辑</button>}
      <div className={styles.saveBar}>
        <p className={styles.visibility}><Icon name={content.visibility === "private" ? "lock" : "people"} size={16} />{content.visibility === "family" ? "全家可见" : content.visibility === "members" ? "指定成员可见" : "仅自己可见"}</p>
        {uploadProgress && <div className={styles.uploadStatus}>
          <p role="status">{uploadProgress.phase === "retrying" ? `连接中断，正在自动续传（${uploadProgress.retry}/3）` : uploadProgress.phase === "confirming" ? "上传完成，正在确认原件…" : `正在上传 ${uploadPercent}%`}</p>
          <progress aria-label="上传进度" value={uploadProgress.uploadedBytes} max={Math.max(1, uploadProgress.totalBytes)} />
          <span>{uploadProgress.filename} · {(uploadProgress.uploadedBytes / 1024 / 1024).toFixed(1)} / {(uploadProgress.totalBytes / 1024 / 1024).toFixed(1)} MB</span>
        </div>}
        {saveError && <p role="alert" className={styles.saveError}>{saveError}</p>}
        {!syncing && !saveError && draft.status === "queued" && <p className={styles.resumeHint}>上次上传未完成，重试会从已收到的位置继续。</p>}
        <button className={styles.saveButton} disabled={syncing || !!diskError || recording || (!content.text.trim() && !content.items.length)} onClick={() => void save(canArchive, !canArchive && content.visibility === "family", canArchive && (draft.status === "queued" ? draft.organizeOnPublish === true : automaticRequested))}><Icon name="check" size={18} />{syncing ? uploadProgress?.phase === "retrying" ? "正在续传…" : uploadProgress?.phase === "uploading" ? `正在上传 ${uploadPercent}%` : "正在保存…" : draft.status === "queued" ? "重试保存" : "保存"}</button>
      </div>
      {!canArchive && <p className={styles.dateNote}>{content.visibility === "family" ? "保存到家庭待整理列表。" : "先保存为私密草稿。"}</p>}
    </>}
  </div>;
}
