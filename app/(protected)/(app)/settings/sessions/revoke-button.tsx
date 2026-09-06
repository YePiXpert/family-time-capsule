"use client";

import { useActionState } from "react";
import { revokeOtherSessionsAction } from "./actions";

export function RevokeSessionsButton({ otherCount }: { otherCount: number }) {
  const [state, formAction, pending] = useActionState(
    revokeOtherSessionsAction,
    undefined,
  );
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <button
        type="submit"
        disabled={pending || otherCount === 0}
        className="min-h-11 w-fit rounded-lg border border-red-700/30 px-4 py-2 text-sm font-medium text-red-800 transition-colors hover:bg-red-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300"
      >
        {pending ? "撤销中…" : otherCount > 0 ? `退出其他 ${otherCount} 台设备` : "没有其他设备在线"}
      </button>
      {state?.error ? (
        <p role="alert" className="text-sm leading-6 text-red-700 dark:text-red-300">
          {state.error}
        </p>
      ) : null}
      {state?.success ? (
        <p role="status" className="text-sm leading-6 text-emerald-700 dark:text-emerald-300">
          {state.success}
        </p>
      ) : null}
    </form>
  );
}
