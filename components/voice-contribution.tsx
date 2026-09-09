"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { listBrowserDrafts, readBrowserOriginal, writeBrowserDraft, type BrowserDraft, type BrowserOriginal } from "@/lib/drafts/browser-store";
import { emptyDraftContent } from "@/lib/drafts/model";
import { uploadDraftOriginal } from "@/lib/drafts/browser-upload";
import { submitVoice, type VoiceReceipt } from "@/mobile/src/contributions/submit-voice";
import { RecordingMeter } from "./recording-meter";
type VoiceDraft = BrowserDraft & { voice: VoiceReceipt };
const visibilityLabels = { family: "全家可见", private: "仅自己", parents: "父母可见", child_later: "留给孩子将来" };
export function VoiceContribution({ scope, memoryId, authorPersonId, authorName, visibility }: { scope: string; memoryId: string; authorPersonId: string; authorName: string; visibility: VoiceReceipt["visibility"] }) {
  const localScope = `${scope}:voice:${memoryId}`;
  const router = useRouter();
  const [row, setRow] = useState<VoiceDraft | null>(null), [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [recording, setRecording] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const current = useRef<VoiceDraft | null>(null), mounted = useRef(true), operation = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null);
  useEffect(() => {
    mounted.current = true;
    void listBrowserDrafts(localScope).then(rows => {
      const pending = (rows as VoiceDraft[]).find(r => r.voice?.memoryId === memoryId && ["editing", "queued"].includes(r.status));
      if (mounted.current && pending) { current.current = pending; setRow(pending); }
    }).catch(() => { if (mounted.current) setMessage("无法读取本机录音草稿，请检查浏览器存储空间。"); }).finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; if (recorder.current?.state === "recording") recorder.current.stop(); stream.current?.getTracks().forEach(t => t.stop()); };
  }, [localScope, memoryId]);
  useEffect(() => {
    if (!row) return;
    let active = true; let url: string | undefined;
    void readBrowserOriginal(localScope, row.voice.originalId).then(original => { if (active && original) { url = URL.createObjectURL(original.file); setPreview(url); } });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [localScope, row?.voice.originalId]); // eslint-disable-line react-hooks/exhaustive-deps -- A status update must not replace the audio element while listening.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (recording) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recording]);
  async function persist(next: VoiceDraft, originals: BrowserOriginal[] = []) {
    await writeBrowserDraft(next, current.current?.id === next.id ? current.current.revision : 0, originals);
    current.current = next; if (mounted.current) setRow(next);
  }
  const guard = () => { if (!mounted.current) throw new Error("页面已关闭，录音仍保存在本机，回来后可以继续。"); };
  async function record() {
    if (operation.current) return;
    operation.current = true; setBusy(true); setMessage("");
    let finishing = false;
    try {
      if (recording) { if (!recorder.current) throw new Error("录音已中断，请重新开始。"); recorder.current.stop(); finishing = true; return; }
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw new Error("当前浏览器不支持直接录音，请使用手机 App 留下声音。");
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      const format = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(m => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(media, format ? { mimeType: format } : undefined);
      recorder.current = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      rec.onstop = () => { void (async () => {
        try {
          const id = crypto.randomUUID(), originalId = crypto.randomUUID();
          const mime = rec.mimeType.split(";", 1)[0] || "audio/webm";
          const file = new File(chunks, `家人的声音.${mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm"}`, { type: mime, lastModified: Date.now() });
          if (!file.size) throw new Error("没有收到录音，请重新录制。");
          const voice: VoiceReceipt = { id, originalId, assetId: null, memoryId, authorPersonId, authorName, visibility, text: "" };
          await persist({ id, scope: localScope, voice, content: { ...emptyDraftContent(), visibility: "private", items: [{ id: originalId, assetId: null, localCaptureRef: originalId, caption: "" }] }, revision: 1, serverRevision: 0, syncedRevision: 0, mutationId: id, status: "editing", memoryEventId: null, updatedAt: new Date().toISOString() }, [{ scope: localScope, id: originalId, file, assetId: null }]);
          if (mounted.current) setMessage("录音已保存在本机，可以先重听，再保存到这条记录。");
        } catch (e) { if (mounted.current) setMessage(e instanceof Error ? e.message : "录音未能保存，请重试。"); }
        finally { media.getTracks().forEach(t => t.stop()); recorder.current = null; stream.current = null; operation.current = false; if (mounted.current) { setRecording(false); setBusy(false); } }
      })(); };
      rec.start(1000); setRecording(true);
    } catch (e) { stream.current?.getTracks().forEach(t => t.stop()); setMessage(e instanceof Error ? e.message : "无法使用麦克风，请检查权限。"); }
    finally { if (!finishing) { operation.current = false; if (mounted.current) setBusy(false); } }
  }
  async function save() {
    if (operation.current || !current.current) return;
    operation.current = true; setBusy(true); setMessage("");
    try {
      const initial = current.current;
      const next: VoiceDraft = { ...initial, voice: initial.status === "editing" ? { ...initial.voice, authorPersonId, authorName, visibility } : initial.voice, status: "queued", revision: initial.revision + 1 };
      await persist(next);
      const request = async (path: string, init: RequestInit = {}) => {
        guard(); const response = await fetch(path, { ...init, headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30000) });
        const data = await response.json(); guard();
        if (!response.ok) throw Object.assign(new Error(response.status === 403 || response.status === 404 ? "当前不能补充这条记录，请核对作者和阅读权限。" : "录音尚未送达，本机原件保留，可以重试。"), { status: response.status });
        return data;
      };
      await submitVoice(next.voice, request, async () => {
        const original = await readBrowserOriginal(localScope, next.voice.originalId);
        if (!original) throw new Error("本机录音不可读，请检查存储空间。");
        const uploaded = await uploadDraftOriginal(original.file, next.voice.originalId, next.id, guard);
        const id = uploaded.assetId || uploaded.existingAssetId;
        if (!id) throw new Error("原件尚未完整上传，可以重试。");
        return id;
      }, async id => { const latest = current.current!; await persist({ ...latest, voice: { ...latest.voice, assetId: id }, revision: latest.revision + 1, content: { ...latest.content, items: latest.content.items.map(i => ({ ...i, assetId: id })) } }); }, guard);
      const latest = current.current!;
      await persist({ ...latest, status: "published", memoryEventId: memoryId, revision: latest.revision + 1 });
      current.current = null; setRow(null); setPreview(null); setMessage("声音已保存到这条成长记录。"); router.refresh();
    } catch (e) { if (mounted.current) setMessage(e instanceof Error ? e.message : "录音尚未送达，本机原件保留。"); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  return <div className="space-y-3 rounded-xl border border-line bg-surface p-3">
    {!row ? <button type="button" className="ui-button-secondary" disabled={busy || loading || !authorPersonId} onClick={() => void record()}>{recording ? "完成录音" : "留段声音"}</button> : <><p className="text-sm text-muted">{row.voice.authorName} · {visibilityLabels[row.voice.visibility]} · 本机录音</p>{preview ? <audio controls src={preview} className="w-full" aria-label="重听待保存的声音" /> : null}<button type="button" disabled={busy} className="ui-button-primary" onClick={() => void save()}>{busy ? "正在保存声音…" : row.status === "queued" ? "重试保存声音" : "保存声音"}</button></>}
    {recording ? <><RecordingMeter streamRef={stream} /><p className="text-sm text-muted">录音中，完成后保存在本机。</p></> : null}
    {message ? <p role="status" className="text-sm text-muted">{message}</p> : null}
  </div>;
}
