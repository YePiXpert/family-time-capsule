"use client";

import { useActionState } from "react";
import { purgeTrashAction, restoreTrashAction, trashEventAction } from "./actions";

export function TrashEntryActions({ kind, id }: { kind: string; id: string }) {
  const [restoreState, restoreAction, restorePending] = useActionState(
    restoreTrashAction,
    undefined,
  );
  const [purgeState, purgeAction, purgePending] = useActionState(
    purgeTrashAction,
    undefined,
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <form action={restoreAction} className="inline">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            disabled={restorePending}
            className="rounded-lg border border-foreground/20 px-3 py-1.5 text-xs transition-colors hover:border-accent disabled:opacity-50"
          >
            {restorePending ? "恢复中…" : "恢复"}
          </button>
        </form>
        <form action={purgeAction} className="inline flex items-center gap-1.5">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <label className="flex items-center gap-1 text-xs text-foreground/50">
            <input type="checkbox" name="confirm" value="purge" required />
            确认彻底清除
          </label>
          <button
            type="submit"
            disabled={purgePending}
            className="rounded-lg border border-red-700/30 px-3 py-1.5 text-xs text-red-700 transition-colors hover:border-red-700/60 disabled:opacity-50 dark:text-red-400"
          >
            {purgePending ? "清除中…" : "彻底清除"}
          </button>
        </form>
      </div>
      {restoreState?.error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {restoreState.error}
        </p>
      )}
      {restoreState?.message && (
        <p role="status" className="text-xs text-foreground/70">
          {restoreState.message}
        </p>
      )}
      {purgeState?.error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {purgeState.error}
        </p>
      )}
      {purgeState?.message && (
        <p role="status" className="text-xs text-foreground/70">
          {purgeState.message}
        </p>
      )}
    </div>
  );
}

/** 事件详情页删除按钮 */
export function TrashEventButton({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState(trashEventAction, undefined);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="eventId" value={eventId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-foreground/10 px-3 py-1.5 text-xs text-foreground/60 transition-colors hover:border-red-500/40 disabled:opacity-50"
      >
        {pending ? "移入中…" : "移到回收站"}
      </button>
      {state?.message && (
        <span role="status" className="ml-2 text-xs text-foreground/60">
          {state.message}
        </span>
      )}
      {state?.error && (
        <span role="alert" className="ml-2 text-xs text-red-700 dark:text-red-400">
          {state.error}
        </span>
      )}
    </form>
  );
}
