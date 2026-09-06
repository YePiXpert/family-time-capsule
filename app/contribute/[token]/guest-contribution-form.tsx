"use client";

import { useMemo, useRef, useState } from "react";
import { runBoundedImportPool } from "@/lib/imports/pool";
import { describeUploadError } from "@/components/upload-request";

type UploadDescriptor = {
  captureId: string;
  uploadId: string;
  uploadOffset: number;
  chunkSize: number;
  expiresAt: string;
};

type FileDeclaration = {
  captureId: string;
  filename: string;
  declaredMime: string;
  totalBytes: number;
  lastModified: number | null;
};

type ItemState = {
  captureId: string;
  name: string;
  size: number;
  uploaded: number;
  status: "pending" | "uploading" | "completed" | "failed";
  error: string | null;
};

type Props = {
  token: string;
  maxFiles: number;
  allowImages: boolean;
  allowAudio: boolean;
  allowVideo: boolean;
  allowDocuments: boolean;
  allowText: boolean;
  allowRecording: boolean;
  allowGuestName: boolean;
};

const DOCUMENT_ACCEPT = "application/pdf,text/plain,text/markdown,text/rtf,application/rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,.txt,.md,.markdown,.rtf,.docx";

function declaredMime(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension === "pdf" ? "application/pdf"
    : extension === "txt" ? "text/plain"
      : extension === "md" || extension === "markdown" ? "text/markdown"
        : extension === "rtf" ? "application/rtf"
          : extension === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "application/octet-stream";
}

function readableBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isVoiceMemo(file: File): boolean {
  return file.name.startsWith("family-voice-") && file.type.startsWith("audio/");
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof value?.error === "string" ? value.error : `request_${response.status}`);
  return value ?? {};
}

export function GuestContributionForm(props: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [guestName, setGuestName] = useState("");
  const [items, setItems] = useState<ItemState[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [working, setWorking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [retryableCaptureIds, setRetryableCaptureIds] = useState<Set<string>>(() => new Set());
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingStream = useRef<MediaStream | null>(null);
  const recordingChunks = useRef<Blob[]>([]);
  const descriptors = useRef(new Map<string, UploadDescriptor>());
  const fileByCapture = useRef(new Map<string, File>());
  const declarationByCapture = useRef(new Map<string, FileDeclaration>());
  const submissionId = useRef<string | null>(null);

  const accept = useMemo(() => [
    props.allowImages ? "image/*" : "",
    props.allowAudio ? "audio/*" : "",
    props.allowVideo ? "video/*" : "",
    props.allowDocuments ? DOCUMENT_ACCEPT : "",
  ].filter(Boolean).join(","), [props.allowAudio, props.allowDocuments, props.allowImages, props.allowVideo]);

  function patchItem(captureId: string, patch: Partial<ItemState>) {
    setItems((current) => current.map((item) => item.captureId === captureId ? { ...item, ...patch } : item));
  }

  async function uploadOne(descriptor: UploadDescriptor): Promise<void> {
    const file = fileByCapture.current.get(descriptor.captureId);
    if (!file) throw new Error("请重新选择同一份文件。");
    patchItem(descriptor.captureId, { status: "uploading", error: null });
    try {
      let offset = descriptor.uploadOffset;
      const head = await fetch(
        `/contribute/${encodeURIComponent(props.token)}/uploads/${descriptor.uploadId}`,
        { method: "HEAD", cache: "no-store" },
      );
      if (!head.ok) throw new Error(`offset_${head.status}`);
      offset = Number(head.headers.get("upload-offset") ?? offset);
      const uploadStatus = head.headers.get("upload-status");
      if (["failed", "expired", "cancelled"].includes(uploadStatus ?? "")) {
        const restarted = await json(await fetch(
          `/contribute/${encodeURIComponent(props.token)}/uploads/${descriptor.uploadId}/retry`,
          { method: "POST" },
        ));
        offset = Number(restarted.uploadOffset ?? 0);
      }
      while (offset < file.size) {
        const end = Math.min(offset + descriptor.chunkSize, file.size);
        const response = await fetch(
          `/contribute/${encodeURIComponent(props.token)}/uploads/${descriptor.uploadId}`,
          {
            method: "PATCH",
            headers: {
              "content-type": "application/offset+octet-stream",
              "upload-offset": String(offset),
            },
            body: file.slice(offset, end),
          },
        );
        if (response.status === 409 && response.headers.has("upload-offset")) {
          offset = Number(response.headers.get("upload-offset"));
          continue;
        }
        if (!response.ok) await json(response);
        offset = Number(response.headers.get("upload-offset") ?? end);
        patchItem(descriptor.captureId, { uploaded: offset });
      }
      await json(await fetch(
        `/contribute/${encodeURIComponent(props.token)}/uploads/${descriptor.uploadId}/complete`,
        { method: "POST" },
      ));
      patchItem(descriptor.captureId, { status: "completed", uploaded: file.size });
    } catch (error) {
      patchItem(descriptor.captureId, {
        status: "failed",
        error: error instanceof Error ? error.message : "upload_failed",
      });
      throw error;
    }
  }

  async function finishSubmission(id: string) {
    await json(await fetch(
      `/contribute/${encodeURIComponent(props.token)}/submissions/${id}/complete`,
      { method: "POST" },
    ));
    setFiles([]);
    setText("");
    setItems([]);
    setSubmitted(true);
    setMessage("已经收到。所有内容会先进入家人的收件箱，整理确认后才进入时间轴。");
  }

  function submitAnother() {
    setSubmitted(false);
    setMessage(null);
    setItems([]);
    setFiles([]);
    setText("");
    submissionId.current = null;
    descriptors.current.clear();
    fileByCapture.current.clear();
    declarationByCapture.current.clear();
    setRetryableCaptureIds(new Set());
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim() && files.length === 0) {
      setMessage("请写一段话或选择至少一份文件。");
      return;
    }
    setWorking(true);
    setMessage(null);
    descriptors.current.clear();
    fileByCapture.current.clear();
    declarationByCapture.current.clear();
    setRetryableCaptureIds(new Set());
    try {
      const declarations = files.map((file) => {
        const captureId = crypto.randomUUID();
        fileByCapture.current.set(captureId, file);
        return {
          captureId,
          filename: file.name || "family-contribution",
          declaredMime: declaredMime(file),
          totalBytes: file.size,
          lastModified: file.lastModified || null,
        };
      });
      for (const declaration of declarations) declarationByCapture.current.set(declaration.captureId, declaration);
      setItems(declarations.map((entry, index) => ({
        captureId: entry.captureId,
        name: files[index].name,
        size: files[index].size,
        uploaded: 0,
        status: "pending",
        error: null,
      })));
      const created = await json(await fetch(
        `/contribute/${encodeURIComponent(props.token)}/submissions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ guestDisplayName: guestName || null, text: text || null, files: declarations }),
        },
      ));
      const id = String(created.submissionId);
      submissionId.current = id;
      const uploads = Array.isArray(created.uploads) ? created.uploads as UploadDescriptor[] : [];
      const failedCaptureIds = new Set(Array.isArray(created.failedCaptureIds) ? created.failedCaptureIds as string[] : []);
      for (const descriptor of uploads) descriptors.current.set(descriptor.captureId, descriptor);
      setRetryableCaptureIds(new Set(declarations.map((declaration) => declaration.captureId)));
      for (const captureId of failedCaptureIds) {
        patchItem(captureId, { status: "failed", error: "服务器暂时无法建立上传，请重新打开链接后重试。" });
      }
      const results = await runBoundedImportPool(uploads, 3, async (descriptor) => uploadOne(descriptor));
      if (failedCaptureIds.size === 0 && results.every((result) => result.status === "fulfilled")) {
        await finishSubmission(id);
      } else {
        setMessage("部分项目尚未完成；已成功的原件不会回滚，可重试失败项。");
      }
    } catch (error) {
      console.error("[contribute] submit failed", error);
      setMessage(describeUploadError(error));
    } finally {
      setWorking(false);
    }
  }

  async function retryFailed() {
    const failedCaptureIds = items
      .filter((item) => item.status === "failed" && retryableCaptureIds.has(item.captureId))
      .map((item) => item.captureId);
    if (failedCaptureIds.length === 0 || !submissionId.current) return;
    setWorking(true);
    setMessage(null);
    const failed: UploadDescriptor[] = [];
    for (const captureId of failedCaptureIds) {
      let descriptor = descriptors.current.get(captureId);
      const declaration = declarationByCapture.current.get(captureId);
      if (!descriptor && declaration) {
        try {
          const created = await json(await fetch(
            `/contribute/${encodeURIComponent(props.token)}/submissions/${submissionId.current}/uploads`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(declaration),
            },
          ));
          descriptor = created.upload as UploadDescriptor;
          descriptors.current.set(captureId, descriptor);
        } catch (error) {
          patchItem(captureId, { error: error instanceof Error ? error.message : "upload_setup_failed" });
        }
      }
      if (descriptor) failed.push(descriptor);
    }
    const results = await runBoundedImportPool(failed, 3, async (descriptor) => uploadOne(descriptor));
    if (failed.length === failedCaptureIds.length && results.every((result) => result.status === "fulfilled")) {
      try { await finishSubmission(submissionId.current); }
      catch (error) {
        console.error("[contribute] complete failed", error);
        setMessage(describeUploadError(error));
      }
    } else {
      setMessage("仍有项目失败；服务器已有进度会保留，可以继续重试。");
    }
    setWorking(false);
  }

  async function toggleRecording() {
    if (recording && recorder.current) {
      const active = recorder.current;
      await new Promise<void>((resolve) => {
        active.addEventListener("stop", () => resolve(), { once: true });
        active.stop();
      });
      recordingStream.current?.getTracks().forEach((track) => track.stop());
      const mime = active.mimeType || "audio/webm";
      const recorded = new File(recordingChunks.current, `family-voice-${Date.now()}.webm`, { type: mime });
      if (files.length >= props.maxFiles) {
        setMessage(`最多 ${props.maxFiles} 份；这份录音没有加入，可先移除已有文件。`);
      } else {
        setFiles((current) => [...current, recorded]);
      }
      recorder.current = null;
      recordingStream.current = null;
      recordingChunks.current = [];
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const next = new MediaRecorder(stream);
      recordingChunks.current = [];
      next.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) recordingChunks.current.push(event.data);
      });
      next.start(1000);
      recorder.current = next;
      recordingStream.current = stream;
      setRecording(true);
    } catch {
      setMessage("无法使用麦克风；仍可选择已有录音或提交文字。");
    }
  }

  const hasRetryable = items.some((item) => item.status === "failed" && retryableCaptureIds.has(item.captureId));

  if (submitted) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        {message ? <p role="status" className="rounded-lg border border-line bg-foreground/[0.03] p-3 text-sm">{message}</p> : null}
        <button type="button" onClick={submitAnother}
          className="min-h-11 self-start rounded-lg border border-foreground/20 px-4 py-2 text-sm">
          再提交一份
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-5">
      {props.allowGuestName ? (
        <label className="flex flex-col gap-2 text-sm font-medium">
          你的称呼（可选）
          <input value={guestName} onChange={(event) => setGuestName(event.target.value)} maxLength={50}
            className="rounded-lg border border-foreground/15 bg-background px-3 py-2 font-normal" placeholder="例如：小姨" />
          <span className="text-xs font-normal text-muted">会标记为“访客填写，未经确认”。</span>
        </label>
      ) : null}
      {props.allowText ? (
        <label className="flex flex-col gap-2 text-sm font-medium">
          留下一段话（可选）
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} maxLength={10_000}
            className="rounded-lg border border-foreground/15 bg-background px-3 py-2 font-normal" />
        </label>
      ) : null}
      {props.maxFiles > 0 ? (
        <label className="flex flex-col gap-2 text-sm font-medium">
          选择文件（最多 {props.maxFiles} 份）
          <input type="file" multiple accept={accept} disabled={working}
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []);
              const merged = [...files];
              let dropped = 0;
              for (const file of selected) {
                if (merged.length >= props.maxFiles) { dropped += 1; continue; }
                if (merged.some((existing) => existing.name === file.name && existing.size === file.size)) continue;
                merged.push(file);
              }
              setFiles(merged);
              setItems([]);
              if (dropped > 0) setMessage(`最多 ${props.maxFiles} 份；多出的 ${dropped} 份没有加入。`);
            }} className="text-sm font-normal" />
          <span className="text-xs font-normal text-muted">每份原件单独续传；失败不会撤销已经完成的项目。</span>
        </label>
      ) : null}
      {props.allowRecording ? (
        <button type="button" onClick={() => void toggleRecording()} disabled={working}
          className="min-h-11 self-start rounded-lg border border-foreground/20 px-4 py-2 text-sm">
          {recording ? "停止并保留录音" : "直接录音"}
        </button>
      ) : null}
      {files.length > 0 && items.length === 0 ? (
        <ul className="space-y-2" aria-label="已选择的文件">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate">{isVoiceMemo(file) ? "语音备忘录" : file.name}</span>
                <span className="text-xs text-muted">{file.type || "未知类型"} · {readableBytes(file.size)}</span>
              </span>
              <button type="button" disabled={working} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                className="min-h-9 shrink-0 rounded-lg border border-foreground/20 px-3 text-xs disabled:opacity-50">移除</button>
            </li>
          ))}
        </ul>
      ) : null}
      {items.length > 0 ? (
        <ul className="space-y-2" aria-label="上传进度">
          {items.map((item) => (
            <li key={item.captureId} className="rounded-lg border border-line p-3 text-sm">
              <div className="flex justify-between gap-3"><span className="truncate">{item.name}</span><span>{item.status === "completed" ? "完成" : item.status === "failed" ? "失败" : `${Math.round(item.uploaded / Math.max(1, item.size) * 100)}%`}</span></div>
              <progress className="mt-2 h-2 w-full accent-accent" max={item.size} value={item.uploaded} />
              {item.error ? <p role="alert" className="mt-1 text-xs text-red-700">{describeUploadError(item.error)}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={working || recording}
          className="min-h-11 rounded-lg bg-foreground px-5 py-2 text-sm font-medium text-background disabled:opacity-50">
          {working ? "正在安全保存…" : "提交给家人"}
        </button>
        {hasRetryable ? (
          <button type="button" onClick={() => void retryFailed()} disabled={working}
            className="min-h-11 rounded-lg border border-foreground/20 px-4 py-2 text-sm disabled:opacity-50">重试失败项</button>
        ) : null}
      </div>
      {message ? <p role="status" className="rounded-lg border border-line bg-foreground/[0.03] p-3 text-sm">{message}</p> : null}
    </form>
  );
}
