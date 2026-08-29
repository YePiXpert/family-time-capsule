"use client";

import { useActionState, useRef, useState } from "react";
import { createTextAction } from "./actions";

type UploadResult = {
  filename: string;
  status: "stored" | "duplicate" | "error";
  message?: string;
  assetId?: string;
};

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-base outline-none transition-colors focus:border-accent";

/** 音频/视频上传（#011）：只做「选择已有文件」；录制留给系统 App，Capture Anywhere */
export function MediaUploadForm({ kind }: { kind: "audio" | "video" }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [uploading, setUploading] = useState(false);

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    const uploaded: UploadResult[] = [];
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      form.append("lastModified", String(file.lastModified));
      try {
        const res = await fetch("/api/upload/media", { method: "POST", body: form });
        const data = await res.json();
        if (data.status === "stored") {
          uploaded.push({ filename: file.name, status: "stored", assetId: data.assetId });
        } else if (data.status === "duplicate") {
          uploaded.push({
            filename: file.name,
            status: "duplicate",
            message: data.message,
            assetId: data.existingAssetId,
          });
        } else {
          uploaded.push({
            filename: file.name,
            status: "error",
            message: data.message ?? "上传失败",
          });
        }
      } catch {
        uploaded.push({ filename: file.name, status: "error", message: "网络错误" });
      }
    }
    setResults((prev) => [...uploaded, ...prev]);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="mt-4">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-foreground/25 bg-foreground/[0.02] px-6 py-8 text-center transition-colors hover:border-accent">
        <span className="text-sm font-medium">
          {kind === "audio" ? "选择录音" : "选择视频"}
        </span>
        <span className="text-xs leading-5 text-foreground/50">
          {kind === "audio"
            ? "语音备忘录、录音机里的文件都可以"
            : "相机里的视频，几个月后补传也可以"}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={kind === "audio" ? "audio/*" : "video/*"}
          multiple
          className="sr-only"
          onChange={onChange}
          disabled={uploading}
        />
      </label>
      {uploading && <p className="mt-3 text-sm text-foreground/60">上传中…</p>}
      <ul className="mt-3 flex flex-col gap-2" aria-label="上传结果">
        {results.map((r, i) => (
          <li
            key={`${r.filename}-${i}`}
            className="flex flex-wrap items-center justify-between gap-x-4 rounded-lg border border-foreground/10 px-4 py-3 text-sm"
          >
            <span className="max-w-[60%] truncate" title={r.filename}>
              {r.filename}
            </span>
            {r.status === "stored" && (
              <span className="text-foreground/60">已保存，等待整理</span>
            )}
            {r.status === "duplicate" && (
              <span className="text-amber-700 dark:text-amber-400">{r.message}</span>
            )}
            {r.status === "error" && (
              <span className="text-red-700 dark:text-red-400">{r.message}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 文字速记（#011）：直接进入收件箱 */
export function TextNoteForm() {
  const [state, formAction, pending] = useActionState(createTextAction, undefined);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      {state?.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state?.saved && (
        <p className="text-sm text-accent">已收进收件箱。</p>
      )}
      <textarea
        name="text"
        required
        maxLength={5000}
        rows={4}
        placeholder="今天想留下什么话？写给未来的她，或只是记下此刻。"
        className={inputClass}
      />
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg border border-foreground/20 px-4 py-2 text-sm transition-colors hover:border-accent disabled:opacity-50"
      >
        {pending ? "保存中…" : "写一段话"}
      </button>
    </form>
  );
}
