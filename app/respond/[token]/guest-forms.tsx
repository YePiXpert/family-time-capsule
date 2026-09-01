"use client";

import { useActionState, useState } from "react";
import {
  submitGuestMediaAction,
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
  const [state, action, pending] = useActionState(submitGuestMediaAction, undefined);
  const [lastModified, setLastModified] = useState("");
  if (state?.success) return <Feedback state={state} />;
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="lastModified" value={lastModified} />
      <input
        type="file"
        name="file"
        required
        accept="audio/*,video/*,image/*"
        aria-label="上传录音、照片或视频"
        className="text-sm"
        onChange={(e) => {
          const file = e.target.files?.[0];
          setLastModified(file ? String(file.lastModified) : "");
        }}
      />
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
