"use client";

import { useActionState } from "react";
import {
  requestInboxSuggestionsAction,
  resolveInboxSuggestionAction,
  type SuggestionActionState,
} from "./actions";

const TYPE_LABEL: Record<string, string> = {
  title: "标题",
  occurred_at: "发生时间",
  person: "参与人",
  tag: "标签",
};

const PRECISION_LABEL: Record<string, string> = {
  exact: "精确",
  approximate: "约",
  date_only: "仅日期",
};

export type InboxSuggestionChipDto = {
  id: string;
  type: string;
  /** 已格式化的展示值（标题文本 / 本地时间 / 人名 / 标签） */
  displayValue: string;
  precision?: string;
};

/**
 * M3-E：收件箱条目的 AI 建议条。
 * 建议值只做表单预填（用户确认前可改）；「不用」即 reject，
 * rejected 建议永远不会自动进入事件。
 */
export function InboxSuggestionChips({
  suggestions,
}: {
  suggestions: InboxSuggestionChipDto[];
}) {
  const [state, action, pending] = useActionState(
    resolveInboxSuggestionAction,
    undefined as SuggestionActionState | undefined,
  );
  if (suggestions.length === 0) return null;

  return (
    <details
      className="mt-2 rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2 text-xs"
      aria-label="AI 整理建议"
    >
      <summary className="min-h-11 py-2 font-medium text-foreground/60">
        AI 生成 · 未确认（{suggestions.length}）
      </summary>
      <p className="text-foreground/50">仅作表单预填，确认前可以修改或不用：</p>
      <ul className="mt-1 flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-1.5 rounded-full border border-foreground/15 px-2.5 py-0.5"
          >
            <span className="text-foreground/50">{TYPE_LABEL[s.type] ?? s.type}</span>
            <span className="max-w-60 truncate">{s.displayValue}</span>
            {s.precision && (
              <span className="text-foreground/40">
                （{PRECISION_LABEL[s.precision] ?? s.precision}）
              </span>
            )}
            <form action={action} className="inline">
              <input type="hidden" name="suggestionId" value={s.id} />
              <input type="hidden" name="action" value="reject" />
              <button
                type="submit"
                disabled={pending}
                className="text-foreground/40 underline underline-offset-2 hover:text-red-700 disabled:opacity-50 dark:hover:text-red-400"
                aria-label={`不用这条${TYPE_LABEL[s.type] ?? ""}建议`}
              >
                不用
              </button>
            </form>
          </li>
        ))}
      </ul>
      {state?.error && (
        <p role="alert" className="mt-1 text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
    </details>
  );
}

/** 顶部批量「AI 整理建议」按钮（worker 异步处理，逐条预填） */
export function InboxSuggestButton() {
  const [state, action, pending] = useActionState(
    requestInboxSuggestionsAction,
    undefined as SuggestionActionState | undefined,
  );
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <form action={action}>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-foreground/20 px-4 py-2 text-sm transition-colors hover:border-accent disabled:opacity-50"
        >
          {pending ? "请求中…" : "AI 整理建议"}
        </button>
      </form>
      <span className="text-xs leading-5 text-foreground/50">
        为待整理条目请求标题 / 时间 / 人物 / 标签建议；在设置中开启 AI 后可用，
        结果仅作预填，确认前都可修改。
      </span>
      {state?.message && (
        <p role="status" className="text-xs text-foreground/70">
          {state.message}
        </p>
      )}
      {state?.error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
    </div>
  );
}
