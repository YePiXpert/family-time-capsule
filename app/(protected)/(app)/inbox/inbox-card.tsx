"use client";

import { useActionState } from "react";
import type { AssetRow } from "@/lib/assets/service";
import type { InboxItemRow } from "@/lib/inbox/service";
import { MediaImage, MediaVideo } from "@/components/media-view";
import { confirmAction, discardAction, editTimeAction } from "./actions";
import { InboxSuggestionChips, type InboxSuggestionChipDto } from "./inbox-suggestion-ui";
import type { InboxPersonOption } from "./inbox-board";
import { StatusBadge } from "@/components/status-badge";

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
  coverThumbAssetId = null,
  canReview,
  suggestionChips = [],
  suggestedTitle,
  suggestedOccurredWall,
  people,
  compact,
}: {
  item: InboxItemRow;
  assets: AssetRow[];
  coverThumbAssetId?: string | null;
  canReview: boolean;
  suggestionChips?: InboxSuggestionChipDto[];
  suggestedTitle?: string;
  /** AI 建议的事件发生时间（家庭时区 datetime-local 值），仅预填 */
  suggestedOccurredWall?: string;
  people: InboxPersonOption[];
  compact: boolean;
}) {
  const [timeState, timeAction, timePending] = useActionState(editTimeAction, undefined);
  const [discardState, discardActionRun, discardPending] = useActionState(discardAction, undefined);
  const [confirmState, confirmActionRun, confirmPending] = useActionState(confirmAction, undefined);
  const cover = assets[0];
  const defaultTitle =
    suggestedTitle ??
    (item.kind === "text" && item.rawText
      ? item.rawText.trim().slice(0, 30)
      : (cover?.originalFilename ?? "一段记忆").replace(/\.[a-z0-9]{1,8}$/i, ""));

  return (
    <article className="h-full overflow-hidden rounded-xl border border-line bg-surface">
      <div className={compact ? "flex h-full flex-col" : "flex flex-col gap-4 p-4 sm:flex-row"}>
        {cover?.type === "image" && (
          <MediaImage
            assetId={cover.id}
            filename={cover.originalFilename}
            mimeType={cover.mimeType}
            thumbAssetId={coverThumbAssetId}
            className={compact ? "aspect-[4/3] w-full" : "h-40 w-48 shrink-0"}
            imgClassName={compact ? "aspect-[4/3] w-full object-cover" : "h-40 w-48 shrink-0 rounded-lg border border-line object-cover"}
          />
        )}
        {cover?.type === "audio" && (
          <audio
            controls
            preload="metadata"
            src={`/api/media/${cover.id}`}
            className={compact ? "m-4 mt-16 w-[calc(100%-2rem)]" : "mt-2 w-full sm:w-80"}
          />
        )}
        {cover?.type === "video" && (
          <MediaVideo
            assetId={cover.id}
            filename={cover.originalFilename}
            mimeType={cover.mimeType}
            className={compact ? "aspect-video w-full" : "h-40 w-48 shrink-0"}
            videoClassName={compact ? "aspect-video w-full object-cover" : "h-40 w-auto shrink-0 rounded-lg border border-line"}
          />
        )}
        <div className={`flex min-w-0 flex-1 flex-col gap-1.5 text-sm ${compact ? "p-4 pt-3" : ""}`}>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="truncate font-medium" title={cover?.originalFilename}>
              {cover?.originalFilename ?? item.rawText?.slice(0, 40)}
            </span>
            <StatusBadge>{item.kind === "text" ? "文字" : cover?.type === "image" ? "照片" : cover?.type}</StatusBadge>
            {item.status === "needs_review" && (
              <StatusBadge tone="warning">待校时</StatusBadge>
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

          {canReview && cover ? <details className="mt-2 rounded-lg border border-line px-3 py-2">
            <summary className="min-h-11 py-2 text-sm font-medium">修正素材拍摄时间</summary>
            <form action={timeAction} className="flex flex-wrap items-center gap-2 pb-2">
              <input type="hidden" name="itemId" value={item.id} />
              <input type="datetime-local" name="capturedAt" required className={`${inputClass} min-h-11 flex-1`} aria-label="修改真实时间" />
              <button type="submit" disabled={timePending} className="ui-button-secondary">{timePending ? "保存中…" : "修改时间"}</button>
              {timeState?.error && timeState.itemId === item.id ? <span className="text-xs text-red-700 dark:text-red-400">{timeState.error}</span> : null}
            </form>
          </details> : null}

          {canReview && <form action={confirmActionRun} className="mt-3 grid gap-2">
            <input type="hidden" name="itemId" value={item.id} />
            <input
              type="text"
              name="title"
              defaultValue={defaultTitle}
              maxLength={100}
              placeholder="这件事的标题"
              aria-label="事件标题"
              className={`${inputClass} min-h-11 w-full`}
            />
            <input
              type="datetime-local"
              name="occurredAt"
              defaultValue={suggestedOccurredWall}
              aria-label="发生时间（可选）"
              className={`${inputClass} min-h-11 w-full`}
            />
            <input type="text" name="locationText" maxLength={200} placeholder="地点（可选）" aria-label="事件地点" className={`${inputClass} min-h-11 w-full`} />
            {people.length > 0 ? (
              <details className="rounded-lg border border-line px-3">
                <summary className="min-h-11 py-2.5">选择人物</summary>
                <fieldset className="pb-2">
                  <legend className="sr-only">参与人物</legend>
                  {people.map((person) => (
                    <label key={person.id} className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" name="participantPersonIds" value={person.id} defaultChecked={person.isChild} className="h-5 w-5 accent-accent" />
                      {person.displayName}
                    </label>
                  ))}
                </fieldset>
              </details>
            ) : null}
            <button
              type="submit"
              disabled={confirmPending}
              className="ui-button-primary w-full"
            >
              {confirmPending ? "整理中…" : "确认进入时间轴"}
            </button>
            {confirmState?.error && confirmState.itemId === item.id && (
              <span className="text-xs text-red-700 dark:text-red-400">
                {confirmState.error}
              </span>
            )}
          </form>}

          {canReview && (
            <InboxSuggestionChips suggestions={suggestionChips} />
          )}

          {canReview && <form action={discardActionRun} className="mt-1">
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
          </form>}
        </div>
      </div>
    </article>
  );
}
