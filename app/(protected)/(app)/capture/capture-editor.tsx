"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadWithProgress } from "@/components/upload-request";
import { Icon } from "@/components/ui/icons";
import { InlineNotice } from "@/components/inline-notice";
import { StatusBadge } from "@/components/status-badge";
import { finalizeCaptureAction } from "./actions";

type PersonOption = { id: string; displayName: string; isChild: boolean };
type CaptureFile = {
  id: string;
  captureId: string;
  file: File;
  status: "pending" | "uploading" | "stored" | "duplicate" | "error";
  progress: number;
  inboxItemId?: string;
  message?: string;
};

const fieldClass =
  "min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

const subscribeToHydration = () => () => {};
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

function fileKind(file: File): "image" | "audio" | "video" | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

function readableBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function CaptureEditor({
  people,
  canArchive,
}: {
  people: PersonOption[];
  canArchive: boolean;
}) {
  const router = useRouter();
  const mixedInputRef = useRef<HTMLInputElement>(null);
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );
  const [files, setFiles] = useState<CaptureFile[]>([]);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [occurredAtWall, setOccurredAtWall] = useState("");
  const [locationText, setLocationText] = useState("");
  const [participantPersonIds, setParticipantPersonIds] = useState<string[]>(
    people.filter((person) => person.isChild).map((person) => person.id),
  );
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<
    | { tone: "success" | "warning" | "danger"; text: string }
    | undefined
  >();
  const [finalizing, startTransition] = useTransition();

  function updateFile(id: string, patch: Partial<CaptureFile>) {
    setFiles((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  }

  async function uploadOne(entry: CaptureFile) {
    const kind = fileKind(entry.file);
    if (!kind) {
      updateFile(entry.id, { status: "error", message: "不支持这种文件格式。" });
      return;
    }
    updateFile(entry.id, {
      status: "uploading",
      progress: 0,
      message: undefined,
    });
    try {
      const response = await uploadWithProgress(
        kind === "image" ? "/api/upload/image" : "/api/upload/media",
        entry.file,
        (progress) => updateFile(entry.id, { progress }),
        { captureId: entry.captureId },
      );
      if (response.status === "stored" && response.inboxItemId) {
        updateFile(entry.id, {
          status: "stored",
          progress: 100,
          inboxItemId: response.inboxItemId,
        });
        return;
      }
      if (response.status === "duplicate" && response.inboxItemId) {
        updateFile(entry.id, {
          status: "duplicate",
          progress: 100,
          inboxItemId: response.inboxItemId,
          message: response.message,
        });
        return;
      }
      updateFile(entry.id, {
        status: "error",
        message: response.message ?? response.error ?? "上传失败，请重试。",
      });
    } catch {
      updateFile(entry.id, {
        status: "error",
        message: "网络中断，原文件仍在你的设备上，可以重试。",
      });
    }
  }

  function addFiles(selected: File[]) {
    if (selected.length === 0) return;
    const additions: CaptureFile[] = selected.map((file) => ({
      id: crypto.randomUUID(),
      captureId: crypto.randomUUID(),
      file,
      status: fileKind(file) ? "pending" : "error",
      progress: 0,
      message: fileKind(file) ? undefined : "仅支持图片、音频和视频。",
    }));
    setFiles((current) => [...current, ...additions]);
    setNotice(undefined);
    for (const entry of additions) {
      if (entry.status === "pending") void uploadOne(entry);
    }
  }

  function onFileInput(event: React.ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function togglePerson(id: string) {
    setParticipantPersonIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function finalize(mode: "inbox" | "archive") {
    setNotice(undefined);
    const itemIds = files.flatMap((entry) =>
      entry.inboxItemId && (entry.status === "stored" || entry.status === "duplicate")
        ? [entry.inboxItemId]
        : [],
    );
    startTransition(async () => {
      const result = await finalizeCaptureAction({
        mode,
        itemIds,
        text,
        title,
        occurredAtWall,
        locationText,
        participantPersonIds,
      });
      if (!result.ok) {
        setNotice({ tone: "danger", text: result.error });
        return;
      }
      if (result.destination === "memory") {
        router.push(`/memories/${result.eventId}`);
        return;
      }
      setText("");
      setNotice({
        tone: "success",
        text: `已收进收件箱。共 ${result.itemCount} 份内容，可以继续记录，也可以稍后整理。`,
      });
    });
  }

  const uploading = files.some(
    (entry) => entry.status === "pending" || entry.status === "uploading",
  );
  const stagedCount = files.filter((entry) => entry.inboxItemId).length;

  return (
    <div className="mt-8 grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
      <div className="min-w-0 space-y-6">
        <section id="text" aria-label="文字" className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
          <label htmlFor="capture-text-note" className="flex items-center gap-2 font-semibold">
            <Icon name="edit" size={19} /> 写下这一刻
          </label>
          <textarea
            id="capture-text-note"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={5000}
            rows={6}
            placeholder="今天想留下什么话？写给未来的她，或只是记下此刻。"
            className={`${fieldClass} mt-3 resize-y text-base leading-7`}
          />
          <p className="mt-2 text-right text-xs text-muted">{text.length}/5000</p>
        </section>

        <section
          aria-label="导入素材"
          className={`rounded-2xl border border-dashed p-4 transition-colors sm:p-6 ${
            dragging ? "border-accent bg-accent-soft" : "border-line bg-surface"
          }`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <div className="flex flex-col items-center gap-3 py-5 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
              <Icon name="upload" size={23} />
            </span>
            <div>
              <h2 className="font-semibold">照片、录音和视频</h2>
              <p className="mt-1 text-sm leading-6 text-muted">
                多选文件，或拖到这里。每份原件会立即安全保存，并逐项显示结果。
              </p>
            </div>
            <button
              type="button"
              className="ui-button-secondary"
              disabled={!hydrated}
              onClick={() => mixedInputRef.current?.click()}
            >
              选择多份素材
            </button>
            {hydrated ? (
              <input
                ref={mixedInputRef}
                type="file"
                accept="image/*,audio/*,video/*"
                multiple
                className="sr-only"
                onChange={onFileInput}
              />
            ) : null}
          </div>

          <div className="grid grid-cols-3 gap-2" aria-label="按类型选择">
            <section id="photo" aria-label="照片">
              <label className="ui-button-secondary w-full cursor-pointer gap-2 px-2">
                <Icon name="image" size={18} /> 照片
                {hydrated ? (
                  <input type="file" accept="image/*" multiple className="sr-only" onChange={onFileInput} />
                ) : null}
              </label>
            </section>
            <section id="audio" aria-label="录音">
              <label className="ui-button-secondary w-full cursor-pointer gap-2 px-2">
                <Icon name="audio" size={18} /> 录音
                {hydrated ? (
                  <input type="file" accept="audio/*" multiple className="sr-only" onChange={onFileInput} />
                ) : null}
              </label>
            </section>
            <section id="media" aria-label="视频">
              <label className="ui-button-secondary w-full cursor-pointer gap-2 px-2">
                <Icon name="video" size={18} /> 视频
                {hydrated ? (
                  <input type="file" accept="video/*" multiple className="sr-only" onChange={onFileInput} />
                ) : null}
              </label>
            </section>
          </div>
        </section>

        {files.length > 0 ? (
          <section aria-label="文件状态">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">本次素材</h2>
              <span className="text-sm text-muted">{stagedCount}/{files.length} 已安全保存</span>
            </div>
            <ul className="mt-3 space-y-2" aria-live="polite" aria-busy={uploading}>
              {files.map((entry) => {
                const kind = fileKind(entry.file);
                return (
                  <li key={entry.id} className="rounded-xl border border-line bg-surface p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted">
                        <Icon name={kind === "image" ? "image" : kind === "audio" ? "audio" : "video"} size={19} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium" title={entry.file.name}>{entry.file.name}</p>
                        <p className="text-xs text-muted">{readableBytes(entry.file.size)}</p>
                      </div>
                      {entry.status === "stored" ? <StatusBadge tone="success">已保存，等待整理</StatusBadge> : null}
                      {entry.status === "duplicate" ? <StatusBadge tone="warning">重复原件</StatusBadge> : null}
                      {entry.status === "uploading" || entry.status === "pending" ? <StatusBadge tone="accent">保存中 {entry.progress}%</StatusBadge> : null}
                      {entry.status === "error" ? <StatusBadge tone="danger">失败</StatusBadge> : null}
                    </div>
                    {entry.status === "uploading" ? (
                      <progress className="mt-2 h-2 w-full accent-accent" value={entry.progress} max={100} aria-label={`${entry.file.name} 上传进度`} />
                    ) : null}
                    {entry.message ? <p className="mt-2 text-xs leading-5 text-muted">{entry.message}</p> : null}
                    {entry.status === "error" ? (
                      <div className="mt-2 flex gap-2">
                        <button type="button" className="ui-button-secondary" onClick={() => void uploadOne(entry)}>重试</button>
                        <button type="button" className="ui-button-secondary" onClick={() => setFiles((current) => current.filter((item) => item.id !== entry.id))}>移除</button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {notice ? <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice> : null}
      </div>

      <aside className="min-w-0">
        <div className="space-y-4 rounded-2xl border border-line bg-surface p-4 lg:sticky lg:top-6">
          <div>
            <h2 className="font-semibold">补充记忆信息</h2>
            <p className="mt-1 text-xs leading-5 text-muted">都可选；先收进来时以后再补也可以。</p>
          </div>
          <label className="block text-sm font-medium">
            标题
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="例如：第一次自己走路" className={`${fieldClass} mt-1`} />
          </label>
          <label className="block text-sm font-medium">
            发生时间
            <input type="datetime-local" value={occurredAtWall} onChange={(event) => setOccurredAtWall(event.target.value)} className={`${fieldClass} mt-1`} />
          </label>
          <label className="block text-sm font-medium">
            地点
            <input value={locationText} onChange={(event) => setLocationText(event.target.value)} maxLength={200} placeholder="例如：外婆家" className={`${fieldClass} mt-1`} />
          </label>
          {people.length > 0 ? (
            <fieldset>
              <legend className="text-sm font-medium">人物</legend>
              <div className="mt-1 space-y-1">
                {people.map((person) => (
                  <label key={person.id} className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm hover:bg-surface-muted">
                    <input type="checkbox" checked={participantPersonIds.includes(person.id)} onChange={() => togglePerson(person.id)} className="h-5 w-5 accent-accent" />
                    {person.displayName}{person.isChild ? "（孩子）" : ""}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div className="space-y-2 border-t border-line pt-4">
            <button
              type="button"
              className="ui-button-secondary w-full"
              disabled={uploading || finalizing}
              onClick={() => finalize("inbox")}
            >
              {finalizing ? "处理中…" : <><span>先收进来</span><span className="sr-only">，写一段话</span></>}
            </button>
            {canArchive ? (
              <button
                type="button"
                className="ui-button-primary w-full"
                disabled={uploading || finalizing}
                onClick={() => finalize("archive")}
              >
                {finalizing ? "整理中…" : "整理并保存"}
              </button>
            ) : (
              <p className="text-xs leading-5 text-muted">当前角色可以记录；入档确认由管理员或编辑完成。</p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
