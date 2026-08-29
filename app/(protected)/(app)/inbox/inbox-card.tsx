"use client";

import { useActionState } from "react";
import type { AssetRow } from "@/lib/assets/service";
import type { InboxItemRow } from "@/lib/inbox/service";
import { discardAction, editTimeAction } from "./actions";

const TIME_SOURCE_LABEL: Record<string, string> = {
  user_confirmed: "你确认的时间",
  embedded_metadata: "照片内嵌时间",
  file_metadata: "文件时间",
  import_time: "导入时间（缺少真实时间，请补充）",
};

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

function formatDateTime(date: Date | null | undefined, fallback = "—"): string {
  if (!date) return fallback;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function InboxCard({
  item,
  assets,
}: {
  item: InboxItemRow;
  assets: AssetRow[];
}) {
  const [timeState, timeAction, timePending] = useActionState(editTimeAction, undefined);
  const [discardState, discardActionRun, discardPending] = useActionState(discardAction, undefined);
  const cover = assets[0];

  return (
    <li className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        {cover?.type === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/media/${cover.id}`}
            alt={cover.originalFilename}
            className="h-32 w-32 shrink-0 rounded-lg border border-foreground/10 object-cover"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="truncate font-medium" title={cover?.originalFilename}>
              {cover?.originalFilename ?? item.rawText?.slice(0, 40)}
            </span>
            <span className="rounded border border-foreground/15 px-1.5 py-0.5 text-xs text-foreground/60">
              {item.kind === "text" ? "文字" : cover?.type === "image" ? "照片" : cover?.type}
            </span>
            {item.status === "needs_review" && (
              <span className="rounded border border-amber-600/40 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                缺少时间
              </span>
            )}
          </div>
          <p className="text-foreground/70">
            拍摄时间：{formatDateTime(cover?.capturedAt ?? null)}
            （{TIME_SOURCE_LABEL[cover?.timeSource ?? "import_time"]}）
          </p>
          <p className="text-foreground/50">
            导入时间：{formatDateTime(cover?.importedAt ?? null)} ·{" "}
            {cover ? `${cover.width ?? "?"}×${cover.height ?? "?"}` : ""}
          </p>

          <form action={timeAction} className="mt-2 flex flex-wrap items-center gap-2">
            <input type="hidden" name="itemId" value={item.id} />
            <input
              type="datetime-local"
              name="capturedAt"
              required
              className={inputClass}
              aria-label="修改真实时间"
            />
            <button
              type="submit"
              disabled={timePending}
              className="rounded-lg border border-foreground/20 px-3 py-1.5 text-xs transition-colors hover:border-accent disabled:opacity-50"
            >
              {timePending ? "保存中…" : "修改时间"}
            </button>
            {timeState?.error && timeState.itemId === item.id && (
              <span className="text-xs text-red-700 dark:text-red-400">{timeState.error}</span>
            )}
          </form>

          <form action={discardActionRun} className="mt-1">
            <input type="hidden" name="itemId" value={item.id} />
            <button
              type="submit"
              disabled={discardPending}
              className="rounded-lg border border-foreground/10 px-3 py-1.5 text-xs text-foreground/60 transition-colors hover:border-red-500/40 hover:text-red-700 disabled:opacity-50 dark:hover:text-red-400"
            >
              {discardPending ? "移除中…" : "不收入时间轴"}
            </button>
            {discardState?.error && discardState.itemId === item.id && (
              <span className="ml-2 text-xs text-red-700 dark:text-red-400">
                {discardState.error}
              </span>
            )}
          </form>
        </div>
      </div>
    </li>
  );
}
