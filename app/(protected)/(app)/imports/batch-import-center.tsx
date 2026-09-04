"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icons";
import { runBoundedImportPool } from "@/lib/imports/pool";

type PersonOption = { id: string; displayName: string; isChild: boolean };
type ServerUpload = {
  id: string;
  filename: string;
  declaredMime: string;
  totalBytes: number;
  receivedBytes: number;
  lastModified: number | null;
  clientFingerprint: string | null;
  status: string;
  expiresAt: string;
};
export type ImportSessionDto = {
  session: {
    id: string;
    source: string;
    status: string;
    totalCount: number;
    completedCount: number;
    failedCount: number;
    defaultTitle: string | null;
    defaultOccurredAt: string | null;
    defaultLocationText: string | null;
    participantPersonIds: string[];
    createdAt: string;
    updatedAt: string;
  };
  items: Array<{
    id: string;
    captureId: string;
    status: string;
    errorCode: string | null;
    sortOrder: number;
    assetId: string | null;
    inboxItemId: string | null;
    upload: ServerUpload | null;
  }>;
};

type LocalItem = {
  key: string;
  captureId: string;
  file: File;
  fingerprint: string;
  uploadId: string | null;
  offset: number;
  status: "pending" | "uploading" | "completed" | "failed";
  error: string | null;
};

const ACCEPT = [
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif", "image/avif",
  "audio/mpeg", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg", "audio/flac",
  "video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/3gpp",
  "application/pdf", "text/plain", "text/markdown", "text/rtf", "application/rtf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
].join(",");

const EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  heic: "image/heic", heif: "image/heif", avif: "image/avif", mp3: "audio/mpeg",
  m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", markdown: "text/markdown",
  rtf: "application/rtf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function mimeFor(file: File): string | null {
  if (file.type) return ACCEPT.split(",").includes(file.type.toLowerCase()) ? file.type.toLowerCase() : null;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME[extension] ?? null;
}

function readableBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function fingerprint(file: File): Promise<string> {
  const slice = 64 * 1024;
  const first = new Uint8Array(await file.slice(0, Math.min(slice, file.size)).arrayBuffer());
  const lastStart = Math.max(first.byteLength, file.size - slice);
  const last = new Uint8Array(await file.slice(lastStart).arrayBuffer());
  const marker = new TextEncoder().encode(`${file.name}\0${file.size}\0${file.lastModified}\0`);
  const input = new Uint8Array(marker.byteLength + first.byteLength + last.byteLength);
  input.set(marker);
  input.set(first, marker.byteLength);
  input.set(last, marker.byteLength + first.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function jsonResponse(response: Response) {
  const body = await response.json().catch(() => ({ error: "invalid_response" })) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `http_${response.status}`);
  return body;
}

export function BatchImportCenter({
  people,
  initial,
}: {
  people: PersonOption[];
  initial?: ImportSessionDto;
}) {
  const router = useRouter();
  const [session, setSession] = useState(initial?.session ?? null);
  const [serverItems, setServerItems] = useState(initial?.items ?? []);
  const [localItems, setLocalItems] = useState<LocalItem[]>([]);
  const [defaultTitle, setDefaultTitle] = useState(initial?.session.defaultTitle ?? "");
  const [defaultOccurredAt, setDefaultOccurredAt] = useState(
    initial?.session.defaultOccurredAt?.slice(0, 16) ?? "",
  );
  const [defaultLocationText, setDefaultLocationText] = useState(initial?.session.defaultLocationText ?? "");
  const [participantIds, setParticipantIds] = useState<string[]>(
    initial?.session.participantPersonIds ?? people.filter((person) => person.isChild).map((person) => person.id),
  );
  const [working, setWorking] = useState(false);
  const [paused, setPaused] = useState(initial?.session.status === "collecting" && Boolean(initial));
  const [message, setMessage] = useState<string | null>(null);
  const pausedRef = useRef(paused);
  const controllers = useRef(new Set<AbortController>());

  function patchLocal(key: string, patch: Partial<LocalItem>) {
    setLocalItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  async function refresh(id: string) {
    const data = await jsonResponse(await fetch(`/api/imports/${id}`, { cache: "no-store" })) as unknown as ImportSessionDto;
    setSession(data.session);
    setServerItems(data.items);
    return data;
  }

  async function selectFiles(files: File[]) {
    setMessage(null);
    const additions: LocalItem[] = [];
    for (const file of files) {
      if (!mimeFor(file)) {
        additions.push({
          key: crypto.randomUUID(), captureId: crypto.randomUUID(), file, fingerprint: "",
          uploadId: null, offset: 0, status: "failed", error: "不支持这种文件格式。",
        });
        continue;
      }
      const feature = await fingerprint(file);
      const matched = serverItems.find((item) => {
        const upload = item.upload;
        return upload && upload.filename === file.name && upload.totalBytes === file.size &&
          upload.lastModified === file.lastModified && upload.clientFingerprint === feature;
      });
      additions.push({
        key: crypto.randomUUID(),
        captureId: matched?.captureId ?? crypto.randomUUID(),
        file,
        fingerprint: feature,
        uploadId: matched?.upload?.id ?? null,
        offset: matched?.upload?.receivedBytes ?? 0,
        status: matched?.status === "completed" ? "completed" : "pending",
        error: null,
      });
    }
    setLocalItems((current) => [...current, ...additions]);
  }

  async function ensureSession(): Promise<string> {
    if (session) return session.id;
    const created = await jsonResponse(await fetch("/api/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "web",
        defaultTitle: defaultTitle || null,
        defaultOccurredAt: defaultOccurredAt || null,
        defaultLocationText: defaultLocationText || null,
        participantPersonIds: participantIds,
      }),
    }));
    const id = String(created.id);
    history.replaceState({}, "", `/imports/${id}`);
    await refresh(id);
    return id;
  }

  async function confirmedOffset(uploadId: string): Promise<number> {
    const response = await fetch(`/api/uploads/${uploadId}`, { method: "HEAD", cache: "no-store" });
    if (!response.ok) throw new Error(`offset_${response.status}`);
    return Number(response.headers.get("upload-offset") ?? 0);
  }

  async function uploadOne(item: LocalItem, importSessionId: string) {
    if (item.status === "completed" || pausedRef.current) return;
    const declaredMime = mimeFor(item.file);
    if (!declaredMime) return;
    patchLocal(item.key, { status: "uploading", error: null });
    try {
      let uploadId = item.uploadId;
      let offset = item.offset;
      if (!uploadId) {
        const created = await jsonResponse(await fetch("/api/uploads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            captureId: item.captureId,
            filename: item.file.name,
            declaredMime,
            totalBytes: item.file.size,
            lastModified: item.file.lastModified || null,
            source: "web",
            importSessionId,
            clientFingerprint: item.fingerprint,
          }),
        }));
        uploadId = String(created.uploadId);
        offset = Number(created.uploadOffset ?? 0);
        if (created.status === "completed") {
          patchLocal(item.key, { uploadId, offset: item.file.size, status: "completed" });
          return;
        }
      } else {
        const match = serverItems.find((entry) => entry.upload?.id === uploadId);
        if (match?.upload && ["failed", "expired", "cancelled"].includes(match.upload.status)) {
          const restarted = await jsonResponse(await fetch(`/api/uploads/${uploadId}/retry`, { method: "POST" }));
          offset = Number(restarted.uploadOffset ?? 0);
        } else {
          offset = await confirmedOffset(uploadId);
        }
      }
      patchLocal(item.key, { uploadId, offset });
      let retries = 0;
      while (offset < item.file.size && !pausedRef.current) {
        const end = Math.min(offset + 8 * 1024 * 1024, item.file.size);
        const controller = new AbortController();
        controllers.current.add(controller);
        try {
          const response = await fetch(`/api/uploads/${uploadId}`, {
            method: "PATCH",
            headers: {
              "content-type": "application/offset+octet-stream",
              "upload-offset": String(offset),
            },
            body: item.file.slice(offset, end),
            signal: controller.signal,
          });
          if (!response.ok) {
            const serverOffset = response.headers.get("upload-offset");
            if (response.status === 409 && serverOffset !== null) {
              offset = Number(serverOffset);
              continue;
            }
            throw new Error((await response.json().catch(() => null))?.error ?? `chunk_${response.status}`);
          }
          offset = Number(response.headers.get("upload-offset") ?? end);
          retries = 0;
          patchLocal(item.key, { offset });
        } catch (error) {
          if (pausedRef.current || controller.signal.aborted) return;
          retries += 1;
          if (retries > 4) throw error;
          offset = await confirmedOffset(uploadId);
          patchLocal(item.key, { offset });
        } finally {
          controllers.current.delete(controller);
        }
      }
      if (pausedRef.current) return;
      await jsonResponse(await fetch(`/api/uploads/${uploadId}/complete`, { method: "POST" }));
      patchLocal(item.key, { status: "completed", offset: item.file.size });
    } catch (error) {
      patchLocal(item.key, {
        status: "failed",
        error: error instanceof Error ? error.message : "upload_failed",
      });
    }
  }

  async function start() {
    if (localItems.length === 0) {
      setMessage("请先选择文件；浏览器不会自动扫描你的相册或磁盘。");
      return;
    }
    setWorking(true);
    setPaused(false);
    pausedRef.current = false;
    try {
      const id = await ensureSession();
      await fetch(`/api/imports/${id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resume" }),
      });
      const candidates = localItems.filter((item) => item.status !== "completed");
      await runBoundedImportPool(candidates, 3, async (candidate) => {
        if (!pausedRef.current) await uploadOne(candidate, id);
      });
      await refresh(id);
      if (!pausedRef.current) setMessage("本轮可上传项已处理；成功原件已进入收件箱，失败项可单独重试。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "import_failed");
    } finally {
      setWorking(false);
    }
  }

  async function pause() {
    pausedRef.current = true;
    setPaused(true);
    for (const controller of controllers.current) controller.abort();
    if (session) {
      await fetch(`/api/imports/${session.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pause" }),
      });
      await refresh(session.id);
    }
  }

  async function cancel() {
    if (!session) {
      setLocalItems([]);
      return;
    }
    pausedRef.current = true;
    for (const controller of controllers.current) controller.abort();
    await fetch(`/api/imports/${session.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel" }),
    });
    await refresh(session.id);
    setPaused(true);
    setMessage("未完成的临时文件已取消；已完成原件不会回滚或删除。");
  }

  const serverCompleted = session?.completedCount ?? 0;
  const denominator = localItems.reduce((sum, item) => sum + item.file.size, 0);
  const uploadedBytes = localItems.reduce((sum, item) => sum + Math.min(item.offset, item.file.size), 0);
  const overall = denominator > 0 ? Math.round(uploadedBytes / denominator * 100) : 0;
  const needsFiles = initial && initial.items.some((item) => item.status !== "completed") && localItems.length === 0;
  const closed = session?.status === "cancelled" || session?.status === "completed";
  const visibleItems = useMemo(() => [...serverItems].sort((a, b) => a.sortOrder - b.sortOrder), [serverItems]);

  return (
    <div className="mt-8 space-y-6">
      {!session ? (
        <section className="grid gap-4 rounded-2xl border border-line bg-surface p-5 sm:grid-cols-2">
          <label className="text-sm">整批默认标题
            <input value={defaultTitle} onChange={(event) => setDefaultTitle(event.target.value)} maxLength={100} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-transparent px-3" placeholder="例如：外婆家的旧照片" />
          </label>
          <label className="text-sm">整批发生时间（可选）
            <input type="datetime-local" value={defaultOccurredAt} onChange={(event) => setDefaultOccurredAt(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-transparent px-3" />
          </label>
          <label className="text-sm">整批地点（可选）
            <input value={defaultLocationText} onChange={(event) => setDefaultLocationText(event.target.value)} maxLength={200} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-transparent px-3" />
          </label>
          <fieldset className="text-sm"><legend>整批人物建议</legend>
            <div className="mt-1 flex flex-wrap gap-3">
              {people.map((person) => <label key={person.id} className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={participantIds.includes(person.id)} onChange={() => setParticipantIds((current) => current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id])} />
                {person.displayName}
              </label>)}
            </div>
          </fieldset>
        </section>
      ) : null}

      <section className="rounded-2xl border border-dashed border-line bg-surface p-6 text-center">
        <Icon name="upload" size={28} className="mx-auto text-accent" />
        <h2 className="mt-3 font-semibold">选择照片、录音、视频或文档</h2>
        <p className="mt-2 text-sm leading-6 text-muted">支持 PDF、TXT、Markdown、RTF、DOCX；HTML 与 SVG 不会作为文档接收。</p>
        <label className="ui-button-primary mt-4 cursor-pointer">
          {needsFiles ? "重新选择同一文件继续" : "选择多份文件"}
          <input type="file" multiple accept={ACCEPT} className="sr-only" onChange={(event) => {
            void selectFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }} />
        </label>
        {needsFiles ? <p className="mt-3 text-sm text-warning">页面刷新后浏览器不再持有原 File。请重新选择；系统会用文件名、大小、修改时间与局部指纹匹配已传进度。</p> : null}
      </section>

      {(localItems.length > 0 || visibleItems.length > 0) ? (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">导入进度</h2>
              <p className="mt-1 text-xs text-muted">整体 {overall}% · 服务器已完成 {serverCompleted}/{session?.totalCount ?? localItems.length}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!working && !closed ? <button type="button" className="ui-button-primary" onClick={() => void start()}>{paused ? "继续" : "开始导入"}</button> : null}
              {working ? <button type="button" className="ui-button-secondary" onClick={() => void pause()}>暂停</button> : null}
              {!closed ? <button type="button" className="ui-button-secondary" onClick={() => void cancel()}>取消未完成项</button> : null}
            </div>
          </div>
          <progress className="mt-4 h-2 w-full accent-accent" value={overall} max={100} />
          <ul className="mt-4 max-h-[34rem] space-y-2 overflow-auto">
            {localItems.map((item) => {
              const progress = item.file.size > 0 ? Math.round(item.offset / item.file.size * 100) : 0;
              return <li key={item.key} className="rounded-xl border border-line px-3 py-3 text-sm">
                <div className="flex items-center justify-between gap-3"><span className="min-w-0 truncate" title={item.file.name}>{item.file.name}</span><span className="shrink-0 text-xs text-muted">{readableBytes(item.file.size)} · {item.status === "completed" ? "已入箱" : `${progress}%`}</span></div>
                {item.error ? <p className="mt-1 text-xs text-danger">{item.error}</p> : null}
              </li>;
            })}
            {localItems.length === 0 ? visibleItems.map((item) => <li key={item.id} className="rounded-xl border border-line px-3 py-3 text-sm">
              <div className="flex items-center justify-between gap-3"><span className="truncate">{item.upload?.filename ?? item.captureId}</span><span className="shrink-0 text-xs text-muted">{item.status === "completed" ? "已入箱" : `${item.upload?.receivedBytes ?? 0}/${item.upload?.totalBytes ?? 0}`}</span></div>
              {item.errorCode ? <p className="mt-1 text-xs text-danger">{item.errorCode}</p> : null}
            </li>) : null}
          </ul>
        </section>
      ) : null}

      {message ? <p className="rounded-xl border border-line bg-surface-muted p-4 text-sm">{message}</p> : null}
      {session && session.completedCount > 0 ? (
        <div className="flex flex-wrap gap-3">
          <Link href="/inbox" className="ui-button-primary">去收件箱整理</Link>
          <button type="button" className="ui-button-secondary" onClick={() => router.refresh()}>刷新服务器进度</button>
        </div>
      ) : null}
      <p className="text-xs leading-5 text-muted">批次只提供事件分组建议，不会自动合并素材、确认事实或发布故事。成功原件不会因其他项失败或取消而回滚。</p>
    </div>
  );
}
