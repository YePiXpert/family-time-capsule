"use client";

import { useActionState } from "react";
import type { AiCapability } from "@/lib/ai/types";
import {
  cancelAiJobAction,
  enableAiConsentAction,
  retryAiJobAction,
  revokeAiConsentAction,
} from "./actions";

function Feedback({
  error,
  success,
}: {
  error?: string;
  success?: string;
}) {
  if (!error && !success) return null;
  return (
    <p
      role={error ? "alert" : "status"}
      className={`mt-3 rounded-lg border p-3 text-sm leading-6 ${
        error
          ? "border-red-800/30 bg-red-500/10 text-red-800 dark:text-red-300"
          : "border-accent/30 bg-accent/10 text-foreground/80"
      }`}
    >
      {error ?? success}
    </p>
  );
}

export function AiConsentControls({
  capability,
  enabled,
}: {
  capability: AiCapability;
  enabled: boolean;
}) {
  const [enableState, enableAction, enabling] = useActionState(
    enableAiConsentAction,
    undefined,
  );
  const [revokeState, revokeAction, revoking] = useActionState(
    revokeAiConsentAction,
    undefined,
  );

  if (enabled) {
    return (
      <form action={revokeAction} className="mt-4">
        <input type="hidden" name="capability" value={capability} />
        <button
          type="submit"
          disabled={revoking}
          className="min-h-11 rounded-lg border border-red-800/30 px-4 py-2 text-sm font-medium text-red-800 transition-colors hover:bg-red-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300"
        >
          {revoking ? "正在关闭…" : "关闭这项外部处理"}
        </button>
        <Feedback error={revokeState?.error} success={revokeState?.success} />
      </form>
    );
  }

  return (
    <form action={enableAction} className="mt-4">
      <input type="hidden" name="capability" value={capability} />
      <label className="flex max-w-xl cursor-pointer items-start gap-3 rounded-lg border border-foreground/10 p-3 text-sm leading-6">
        <input
          type="checkbox"
          name="allowAutomaticFamilyContent"
          value="yes"
          className="mt-1 size-4 accent-[var(--accent)]"
        />
        <span>
          允许系统自动处理明确标为“家人可见”的内容
          <span className="block text-xs text-foreground/55">
            private、仅父母和长大后可见内容始终需要有权家人逐项触发。
          </span>
        </span>
      </label>
      <button
        type="submit"
        disabled={enabling}
        className="mt-3 min-h-11 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {enabling ? "正在保存…" : "同意启用这项外部处理"}
      </button>
      <Feedback error={enableState?.error} success={enableState?.success} />
    </form>
  );
}

export function AiJobCancelControl({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState(cancelAiJobAction, undefined);
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="jobId" value={jobId} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium transition-colors hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "正在停止…" : "停止任务"}
      </button>
      <Feedback error={state?.error} success={state?.success} />
    </form>
  );
}

export function AiJobRetryControl({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState(retryAiJobAction, undefined);
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="jobId" value={jobId} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium transition-colors hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "正在重新检查…" : "重新检查来源并重试"}
      </button>
      <Feedback error={state?.error} success={state?.success} />
    </form>
  );
}
