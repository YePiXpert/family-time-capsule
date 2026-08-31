"use client";

import { useActionState, useState } from "react";
import type { AssetRow } from "@/lib/assets/service";
import type { InboxItemRow } from "@/lib/inbox/service";
import { InboxCard } from "./inbox-card";
import { mergeAction } from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

export type InboxEntryDto = {
  item: InboxItemRow;
  assets: AssetRow[];
  coverThumbAssetId?: string | null;
};

/** 收件箱面板：多选合并（#010）+ 单条操作 */
export function InboxBoard({
  entries,
  canReview,
}: {
  entries: InboxEntryDto[];
  canReview: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeState, mergeActionRun, mergePending] = useActionState(mergeAction, undefined);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedCount = selected.size;

  return (
    <div className="mt-8 flex flex-col gap-4">
      {canReview && selectedCount >= 2 && (
        <form
          action={mergeActionRun}
          className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-background/95 p-3 shadow-sm backdrop-blur"
          aria-label="合并所选"
        >
          {[...selected].map((id) => (
            <input key={id} type="hidden" name="itemIds" value={id} />
          ))}
          <span className="text-sm text-foreground/70">
            已选 {selectedCount} 项，合并为一个事件
          </span>
          <input
            type="text"
            name="title"
            required
            maxLength={100}
            placeholder="这件事的标题"
            aria-label="合并事件标题"
            className={`${inputClass} min-w-40 flex-1`}
          />
          <input
            type="datetime-local"
            name="occurredAt"
            aria-label="发生时间（默认取最早拍摄时间）"
            className={inputClass}
          />
          <button
            type="submit"
            disabled={mergePending}
            className="rounded-lg bg-foreground px-3 py-1.5 text-xs text-background transition-opacity disabled:opacity-50"
          >
            {mergePending ? "合并中…" : "合并"}
          </button>
          {mergeState?.error && (
            <span className="text-xs text-red-700 dark:text-red-400">
              {mergeState.error}
            </span>
          )}
        </form>
      )}

      <ul className="flex flex-col gap-4" aria-label="待整理列表">
        {entries.map((entry) => {
          const id = entry.item.id;
          const checked = selected.has(id);
          return (
            <li key={id} className="flex items-start gap-3">
              {canReview && (
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(id)}
                  aria-label={`选择 ${entry.assets[0]?.originalFilename ?? entry.item.rawText?.slice(0, 12) ?? "条目"}`}
                  className="mt-6 h-4 w-4 shrink-0 accent-[var(--accent)]"
                />
              )}
              <div className="min-w-0 flex-1">
                <InboxCard
                  item={entry.item}
                  assets={entry.assets}
                  coverThumbAssetId={entry.coverThumbAssetId ?? null}
                  canReview={canReview}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
