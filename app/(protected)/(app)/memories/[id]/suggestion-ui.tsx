"use client";

import { useState } from "react";
import { useActionState } from "react";
import type { AiSuggestionRow } from "@/db/schema/suggestion";
import type { AiJobSummary } from "@/lib/ai/jobs";
import {
  requestEventSuggestionsAction,
  resolveSuggestionAction,
} from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

const SUGGESTION_TYPE_LABEL: Record<string, string> = {
  title: "标题",
  location: "地点",
  occurred_at: "发生时间",
  person: "参与人",
  tag: "标签",
};

const PRECISION_LABEL: Record<string, string> = {
  exact: "精确",
  approximate: "约",
  date_only: "仅日期",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "待审",
  accepted: "已接受",
  rejected: "已拒绝",
};

function StatusLabel({ job }: { job: AiJobSummary | undefined }) {
  if (!job) return null;
  if (job.status === "pending" || job.status === "running") {
    return (
      <span className="rounded-full border border-foreground/10 px-3 py-1 text-xs text-foreground/65">
        处理中
      </span>
    );
  }
  if (job.status === "failed") {
    return (
      <span className="rounded-full border border-red-800/30 px-3 py-1 text-xs text-red-800 dark:text-red-300">
        失败可重试
      </span>
    );
  }
  return (
    <span className="rounded-full border border-foreground/10 px-3 py-1 text-xs text-foreground/50">
      已完成
    </span>
  );
}

function SuggestionCard({
  suggestion,
  canWrite,
}: {
  suggestion: AiSuggestionRow;
  canWrite: boolean;
}) {
  const [editValue, setEditValue] = useState("");
  const [state, action, pending] = useActionState(resolveSuggestionAction, undefined);

  let displayValue = "";
  let precisionLabel: string | undefined;
  try {
    const payload = JSON.parse(suggestion.valueJson);
    if (suggestion.suggestionType === "title") displayValue = payload.title ?? "";
    if (suggestion.suggestionType === "location") displayValue = payload.locationText ?? "";
    if (suggestion.suggestionType === "person") displayValue = payload.personName ?? "";
    if (suggestion.suggestionType === "tag") displayValue = payload.tag ?? "";
    if (suggestion.suggestionType === "occurred_at") {
      const d = new Date(String(payload.occurredAt ?? ""));
      displayValue = Number.isNaN(d.getTime())
        ? ""
        : new Intl.DateTimeFormat("zh-CN", {
            dateStyle: "medium",
            timeStyle: payload.precision === "date_only" ? undefined : "short",
          }).format(d);
      precisionLabel = PRECISION_LABEL[payload.precision] ?? PRECISION_LABEL.approximate;
    }
  } catch {
    displayValue = suggestion.valueJson;
  }

  // occurred_at 不提供自由文本编辑：时间修正走事件编辑表单（含家庭时区换算），
  // 接受即按建议值 + 建议精度更新事件时间
  const editable =
    suggestion.suggestionType === "title" ||
    suggestion.suggestionType === "location" ||
    suggestion.suggestionType === "tag";

  return (
    <li className="rounded-lg border border-foreground/10 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="text-xs text-foreground/50">
            {SUGGESTION_TYPE_LABEL[suggestion.suggestionType] ?? suggestion.suggestionType}
          </span>
          <span className="ml-2">{displayValue}</span>
          {precisionLabel && (
            <span className="ml-1 text-xs text-foreground/40">
              （{precisionLabel}）
            </span>
          )}
        </span>
        {canWrite && (
          <form action={action} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="suggestionId" value={suggestion.id} />
            {editable && (
              <input
                name="editedValue"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder={`编辑后接受`}
                className={`${inputClass} w-40`}
              />
            )}
            <button
              type="submit"
              name="action"
              value="accept"
              disabled={pending}
              className="rounded border border-foreground/15 px-2 py-0.5 hover:border-accent disabled:opacity-50"
            >
              接受
            </button>
            <button
              type="submit"
              name="action"
              value="reject"
              disabled={pending}
              className="rounded border border-foreground/15 px-2 py-0.5 text-foreground/60 hover:border-red-500/40 disabled:opacity-50"
            >
              拒绝
            </button>
            {state?.error && (
              <span className="text-xs text-red-700 dark:text-red-400">{state.error}</span>
            )}
          </form>
        )}
      </div>
    </li>
  );
}

export function SuggestionSection({
  memoryEventId,
  suggestions,
  tags,
  latestJob,
  canRequest,
  canWrite,
}: {
  memoryEventId: string;
  suggestions: AiSuggestionRow[];
  tags: string[];
  latestJob: AiJobSummary | undefined;
  canRequest: boolean;
  canWrite: boolean;
}) {
  const [state, action, pending] = useActionState(
    requestEventSuggestionsAction,
    undefined,
  );

  const pendingSuggestions = suggestions.filter((s) => s.status === "pending");
  const resolvedSuggestions = suggestions.filter((s) => s.status !== "pending");

  return (
    <section aria-label="AI 整理建议" className="mt-10">
      <h2 className="text-lg font-medium">AI 整理建议</h2>
      <p className="mt-1 text-sm leading-6 text-foreground/50">
        AI 只产出可审建议；接受后才会写入事件。拒绝的内容不会进入时间轴或故事。
      </p>

      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-foreground/10 px-2.5 py-0.5 text-xs text-foreground/70"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        {canRequest && (
          <form action={action}>
            <input type="hidden" name="memoryEventId" value={memoryEventId} />
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "请求中…" : "生成整理建议"}
            </button>
          </form>
        )}
        <StatusLabel job={latestJob} />
      </div>
      {state?.error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}

      {pendingSuggestions.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {pendingSuggestions.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} canWrite={canWrite} />
          ))}
        </ul>
      )}

      {resolvedSuggestions.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-foreground/60">
            已处理建议（{resolvedSuggestions.length}）
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {resolvedSuggestions.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-foreground/10 px-4 py-2 text-sm text-foreground/60"
              >
                <span className="text-xs text-foreground/40">
                  {SUGGESTION_TYPE_LABEL[s.suggestionType] ?? s.suggestionType}
                </span>
                <span className="ml-2">{STATUS_LABEL[s.status] ?? s.status}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
