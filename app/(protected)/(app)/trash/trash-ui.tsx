"use client";

import { useActionState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
            className="rounded-lg border border-red-700/30 px-3 py-1.5 text-xs text-danger transition-colors hover:border-red-700/60 disabled:opacity-50"
          >
            {purgePending ? "清除中…" : "彻底清除"}
          </button>
        </form>
      </div>
      {restoreState?.error && (
        <p role="alert" className="text-xs text-danger">
          {restoreState.error}
        </p>
      )}
      {restoreState?.message && (
        <p role="status" className="text-xs text-foreground/70">
          {restoreState.message}
        </p>
      )}
      {purgeState?.error && (
        <p role="alert" className="text-xs text-danger">
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
  const [state, action] = useActionState(trashEventAction, undefined);
  return (
    <div className="inline">
      <ConfirmDialog
        triggerLabel="移到回收站"
        title="移到回收站？"
        description="这条记忆会移到回收站，不会立刻删除；之后可以在回收站页面随时恢复它。"
        confirmLabel="移到回收站"
        destructive
        onConfirm={() => {
          const formData = new FormData();
          formData.set("eventId", eventId);
          action(formData);
        }}
      />
      {state?.message && (
        <span role="status" className="ml-2 text-xs text-foreground/60">
          {state.message}
        </span>
      )}
      {state?.error && (
        <span role="alert" className="ml-2 text-xs text-danger">
          {state.error}
        </span>
      )}
    </div>
  );
}
