"use client";

import { useActionState } from "react";
import { runBackupAction } from "./actions";

export function RunBackupButton() {
  const [state, action, pending] = useActionState(runBackupAction, undefined);
  return (
    <div className="flex flex-col gap-1">
      <form action={action}>
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "备份中…" : "立即备份到 WebDAV"}
        </button>
      </form>
      {state?.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state?.message && (
        <p role="status" className="text-sm text-foreground/70">
          {state.message}
        </p>
      )}
    </div>
  );
}
