"use client";

import { useActionState, useRef, useState } from "react";
import { uploadWithProgress } from "@/components/upload-request";
import {
  submitGuestTextAction,
  type GuestSubmitState,
} from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

function Feedback({ state }: { state: GuestSubmitState | undefined }) {
  if (!state) return null;
  return (
    <>
      {state.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-sm text-foreground/70">
          已收到，谢谢！家人会整理后收进时间轴。
        </p>
      )}
    </>
  );
}

export function GuestTextForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(submitGuestTextAction, undefined);
  if (state?.success) return <Feedback state={state} />;
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="token" value={token} />
      <textarea
        name="text"
        required
        rows={6}
        maxLength={10000}
        placeholder="慢慢说，想到什么写什么。"
        aria-label="你的讲述"
        className={inputClass}
      />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 self-start rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "提交中…" : "提交讲述"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function GuestMediaForm({ token }: { token: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<GuestSubmitState>();
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState(0);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setState({ error: "请选择要上传的文件。" });
      return;
    }
    setPending(true);
    setProgress(0);
    setState(undefined);
    try {
      const response = await uploadWithProgress(
        `/respond/${encodeURIComponent(token)}/upload`,
        file,
        setProgress,
      );
      if (response.success) {
        setState({ success: true });
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
      } else {
        setState({ error: response.message ?? "上传失败，请检查文件格式。" });
      }
    } catch {
      setState({ error: "网络错误，上传失败。请稍后重试。" });
    } finally {
      setPending(false);
    }
  }

  if (state?.success) return <Feedback state={state} />;
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor="guest-media" className="text-sm font-medium">
        选择录音、照片或视频
      </label>
      <input
        ref={inputRef}
        id="guest-media"
        type="file"
        name="file"
        required
        accept="audio/*,video/*,image/*"
        className="text-sm"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setState(undefined);
        }}
      />
      {pending && (
        <div className="flex items-center gap-3 text-sm text-foreground/60" role="status">
          <progress
            className="h-2 w-36 accent-accent"
            max={100}
            value={progress}
            aria-label="访客媒体上传进度"
          />
          {progress}%
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 self-start rounded-lg border border-foreground/20 px-4 py-2 text-sm transition-colors hover:border-accent disabled:opacity-50"
      >
        {pending ? "上传中…" : "上传录音 / 照片 / 视频"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
