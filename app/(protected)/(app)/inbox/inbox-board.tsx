"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/ui/icons";
import type { AssetRow } from "@/lib/assets/service";
import type { InboxItemRow } from "@/lib/inbox/service";
import { InboxCard } from "./inbox-card";
import type { InboxSuggestionChipDto } from "./inbox-suggestion-ui";
import { mergeAction } from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

export type InboxEntryDto = {
  item: InboxItemRow;
  assets: AssetRow[];
  coverThumbAssetId?: string | null;
  suggestionChips?: InboxSuggestionChipDto[];
  suggestedTitle?: string;
  suggestedOccurredWall?: string;
};

export type InboxPersonOption = {
  id: string;
  displayName: string;
  isChild: boolean;
};

/** 收件箱面板：多选合并（#010）+ 单条操作 */
export function InboxBoard({
  entries,
  canReview,
  people,
}: {
  entries: InboxEntryDto[];
  canReview: boolean;
  people: InboxPersonOption[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"grid" | "list">("grid");
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

  const needsTime = entries.filter((entry) => entry.item.status === "needs_review").length;
  const suggested = entries.filter((entry) => (entry.suggestionChips?.length ?? 0) > 0).length;

  return (
    <div className="mt-8 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2">
        <p className="text-sm text-muted">
          <strong className="text-foreground">{entries.length}</strong> 项待整理
          {needsTime > 0 ? ` · ${needsTime} 项待校时` : ""}
          {suggested > 0 ? ` · ${suggested} 项有未确认建议` : ""}
        </p>
        <div className="flex gap-1" role="group" aria-label="收件箱视图">
          <button type="button" className={view === "grid" ? "ui-button-primary" : "ui-button-secondary"} aria-pressed={view === "grid"} onClick={() => setView("grid")}>
            <Icon name="image" size={17} />
            <span className="ml-2">网格</span>
          </button>
          <button type="button" className={view === "list" ? "ui-button-primary" : "ui-button-secondary"} aria-pressed={view === "list"} onClick={() => setView("list")}>
            <Icon name="timeline" size={17} />
            <span className="ml-2">列表</span>
          </button>
        </div>
      </div>
      {canReview && selectedCount >= 2 && (
        <form
          action={mergeActionRun}
          className="sticky top-2 z-10 rounded-xl border border-accent bg-background p-4 shadow-sm"
          aria-label="合并所选"
        >
          {[...selected].map((id) => (
            <input key={id} type="hidden" name="itemIds" value={id} />
          ))}
          <span className="block text-sm font-semibold text-foreground">
            已选 {selectedCount} 项，合并为一个事件
          </span>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <input type="text" name="title" required maxLength={100} placeholder="这件事的标题" aria-label="合并事件标题" className={inputClass} />
            <input type="datetime-local" name="occurredAt" aria-label="发生时间（默认取最早拍摄时间）" className={inputClass} />
            <input type="text" name="locationText" maxLength={200} placeholder="地点（可选）" aria-label="合并事件地点" className={inputClass} />
            <button type="submit" disabled={mergePending} className="ui-button-primary">
              {mergePending ? "合并中…" : "合并"}
            </button>
          </div>
          {people.length > 0 ? (
            <label className="mt-3 block text-sm font-medium">
              参与人物（可多选）
              <select
                name="participantPersonIds"
                multiple
                defaultValue={people.filter((person) => person.isChild).map((person) => person.id)}
                className={`${inputClass} mt-1 min-h-11 w-full`}
                aria-label="合并事件人物"
              >
                {people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
              </select>
            </label>
          ) : null}
          {mergeState?.error && (
            <span className="mt-2 block text-xs text-red-700 dark:text-red-400">
              {mergeState.error}
            </span>
          )}
        </form>
      )}

      <ul className={view === "grid" ? "grid gap-4 md:grid-cols-2" : "flex flex-col gap-4"} aria-label="待整理列表">
        {entries.map((entry) => {
          const id = entry.item.id;
          const checked = selected.has(id);
          return (
            <li key={id} className="relative min-w-0">
              {canReview && (
                <label className="absolute left-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface shadow-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(id)}
                    aria-label={`选择 ${entry.assets[0]?.originalFilename ?? entry.item.rawText?.slice(0, 12) ?? "条目"}`}
                    className="h-5 w-5 shrink-0 accent-accent"
                  />
                </label>
              )}
              <div className="min-w-0">
                <InboxCard
                  item={entry.item}
                  assets={entry.assets}
                  coverThumbAssetId={entry.coverThumbAssetId ?? null}
                  canReview={canReview}
                  suggestionChips={entry.suggestionChips}
                  suggestedTitle={entry.suggestedTitle}
                  suggestedOccurredWall={entry.suggestedOccurredWall}
                  people={people}
                  compact={view === "grid"}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
