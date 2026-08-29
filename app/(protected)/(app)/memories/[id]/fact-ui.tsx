"use client";

import { useActionState } from "react";
import type { FactRow } from "@/lib/contributions/service";
import { addFactAction, setFactStatusAction } from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

const STATUS_LABEL: Record<string, string> = {
  ai_suggested: "AI 建议",
  user_confirmed: "已确认",
  rejected: "已否决",
};

export function FactSection({
  memoryEventId,
  facts,
}: {
  memoryEventId: string;
  facts: FactRow[];
}) {
  const [addState, addAction, addPending] = useActionState(addFactAction, undefined);
  const [, statusAction] = useActionState(setFactStatusAction, undefined);

  return (
    <section aria-label="已确认事实" className="mt-10">
      <h2 className="text-lg font-medium">已确认事实</h2>
      <p className="mt-1 text-sm leading-6 text-foreground/50">
        只记录双方都认可、可长期相信的事实。P0 全部由家人手工确认。
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {facts.map((f) => (
          <li
            key={f.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-foreground/10 px-4 py-2.5 text-sm"
          >
            <span className="min-w-0 flex-1">{f.statement}</span>
            <span className="flex items-center gap-2 text-xs text-foreground/50">
              {STATUS_LABEL[f.status] ?? f.status}
              {f.status === "ai_suggested" && (
                <form action={statusAction}>
                  <input type="hidden" name="factId" value={f.id} />
                  <input type="hidden" name="memoryEventId" value={memoryEventId} />
                  <input type="hidden" name="status" value="user_confirmed" />
                  <button className="rounded border border-foreground/15 px-2 py-0.5 hover:border-accent">
                    确认
                  </button>
                </form>
              )}
              {f.status !== "rejected" && (
                <form action={statusAction}>
                  <input type="hidden" name="factId" value={f.id} />
                  <input type="hidden" name="memoryEventId" value={memoryEventId} />
                  <input type="hidden" name="status" value="rejected" />
                  <button className="rounded border border-foreground/15 px-2 py-0.5 text-foreground/60 hover:border-red-500/40">
                    否决
                  </button>
                </form>
              )}
            </span>
          </li>
        ))}
      </ul>
      <form action={addAction} className="mt-3 flex flex-wrap gap-2">
        <input type="hidden" name="memoryEventId" value={memoryEventId} />
        <input
          name="statement"
          required
          maxLength={500}
          placeholder="一件可以确认的事，如：小满第一次自己翻身"
          className={`${inputClass} min-w-56 flex-1`}
          aria-label="新增事实"
        />
        <button
          type="submit"
          disabled={addPending}
          className="rounded-lg border border-foreground/20 px-3 py-2 text-sm transition-colors hover:border-accent disabled:opacity-50"
        >
          {addPending ? "添加中…" : "添加事实"}
        </button>
        {addState?.error && (
          <span className="text-xs text-red-700 dark:text-red-400">{addState.error}</span>
        )}
      </form>
    </section>
  );
}
