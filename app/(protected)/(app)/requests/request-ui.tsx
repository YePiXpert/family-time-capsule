"use client";

import { useActionState } from "react";
import { closeRequestAction, createRequestAction } from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

export function RequestCreateForm({
  topics,
}: {
  topics: Array<{ key: string; label: string; questions: string[] }>;
}) {
  const [state, action, pending] = useActionState(createRequestAction, undefined);

  if (state?.token) {
    const url = `${window.location.origin}/respond/${state.token}`;
    return (
      <div className="rounded-xl border border-accent/40 bg-background p-4">
        <p className="text-sm font-medium">链接已创建，发送给家人：</p>
        <p className="mt-2 break-all rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2 text-sm">
          {url}
        </p>
        <p className="mt-2 text-xs text-foreground/50">
          有效期至 {state.expiresAt}。家人打开即可回答；提交先进收件箱审核。
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <input
          name="recipientLabel"
          required
          maxLength={50}
          placeholder="称呼，如：外婆"
          aria-label="家人的称呼"
          className={`${inputClass} min-w-32 flex-1`}
        />
        <select name="topicKey" aria-label="话题" className={inputClass} defaultValue="custom">
          {topics.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
          <option value="custom">自拟问题</option>
        </select>
      </div>
      <textarea
        name="promptText"
        required
        rows={3}
        maxLength={500}
        placeholder="想问这位家人的问题（可以从话题库里选一句改一改）"
        aria-label="问题"
        className={inputClass}
      />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 self-start rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "创建中…" : "创建讲述链接"}
      </button>
      {state?.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function CloseRequestButton({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(closeRequestAction, undefined);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="requestId" value={requestId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-foreground/15 px-2 py-0.5 text-xs text-foreground/60 hover:border-red-500/40 disabled:opacity-50"
      >
        {pending ? "关闭中…" : "关闭链接"}
      </button>
      {state?.error && (
        <span className="ml-2 text-xs text-red-700 dark:text-red-400">{state.error}</span>
      )}
    </form>
  );
}
