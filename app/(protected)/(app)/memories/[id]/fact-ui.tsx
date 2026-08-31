"use client";

import { useActionState } from "react";
import type { FactRow } from "@/lib/contributions/service";
import type { FactSourceRow } from "@/db/schema/suggestion";
import { addFactAction, setFactStatusAction } from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

const STATUS_LABEL: Record<string, string> = {
  ai_suggested: "AI 建议",
  user_confirmed: "已确认",
  rejected: "已否决",
};

const SOURCE_TYPE_LABEL: Record<string, string> = {
  asset: "原件",
  asset_analysis: "AI 图像理解",
  transcript: "转录",
  contribution: "讲述",
  user_text: "手工记录",
};

function formatMsRange(startMs: number, endMs: number): string {
  const clock = (ms: number) => {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };
  return `${clock(startMs)}–${clock(endMs)}`;
}

/** M3-D：来源详情——类型 / 素材或讲述 / 逐字引文 / 转录时间段 */
function SourceDetail({
  source,
  label,
}: {
  source: FactSourceRow;
  label?: string;
}) {
  const type = SOURCE_TYPE_LABEL[source.sourceType] ?? source.sourceType;
  return (
    <li className="rounded-lg border border-foreground/10 bg-foreground/[0.02] px-3 py-2 text-xs leading-5">
      <span className="text-foreground/50">{type}</span>
      {label && <span className="ml-2 text-foreground/70">{label}</span>}
      {source.startMs !== null && source.endMs !== null && (
        <span className="ml-2 text-foreground/50">
          {formatMsRange(source.startMs, source.endMs)}
        </span>
      )}
      {source.quote && (
        <blockquote className="mt-1 border-l-2 border-foreground/15 pl-2 text-foreground/80">
          「{source.quote}」
        </blockquote>
      )}
    </li>
  );
}

function SourceList({
  sources,
  labels,
}: {
  sources: FactSourceRow[];
  labels: Map<string, string>;
}) {
  if (sources.length === 0) return null;
  if (sources.length === 1 && !sources[0].quote && sources[0].sourceType === "user_text") {
    return (
      <span className="ml-2 text-xs text-foreground/40">来源：手工记录</span>
    );
  }
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-foreground/40 hover:text-foreground/70">
        来源（{sources.length}）
      </summary>
      <ul className="mt-1 flex flex-col gap-1">
        {sources.map((s) => (
          <SourceDetail key={s.id} source={s} label={labels.get(s.id)} />
        ))}
      </ul>
    </details>
  );
}

export function FactSection({
  memoryEventId,
  facts,
  factSources,
  sourceLabels,
  canWrite,
}: {
  memoryEventId: string;
  facts: FactRow[];
  factSources: FactSourceRow[];
  /** factSourceId → 展示名（素材文件名 / 转录素材 / 讲述作者） */
  sourceLabels: Map<string, string>;
  canWrite: boolean;
}) {
  const sourcesByFactId = new Map<string, FactSourceRow[]>();
  for (const source of factSources) {
    const list = sourcesByFactId.get(source.factId) ?? [];
    list.push(source);
    sourcesByFactId.set(source.factId, list);
  }
  const [addState, addAction, addPending] = useActionState(addFactAction, undefined);
  const [, statusAction] = useActionState(setFactStatusAction, undefined);

  return (
    <section aria-label="已确认事实" className="mt-10">
      <h2 className="text-lg font-medium">已确认事实</h2>
      <p className="mt-1 text-sm leading-6 text-foreground/50">
        只记录双方都认可、可长期相信的事实；每条事实都能追溯到具体来源与原文。
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {facts.map((f) => (
          <li
            key={f.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-foreground/10 px-4 py-2.5 text-sm"
          >
            <span className="min-w-0 flex-1">
              {f.statement}
              <SourceList
                sources={sourcesByFactId.get(f.id) ?? []}
                labels={sourceLabels}
              />
            </span>
            <span className="flex items-center gap-2 text-xs text-foreground/50">
              {STATUS_LABEL[f.status] ?? f.status}
              {canWrite && f.status === "ai_suggested" && (
                <form action={statusAction}>
                  <input type="hidden" name="factId" value={f.id} />
                  <input type="hidden" name="memoryEventId" value={memoryEventId} />
                  <input type="hidden" name="status" value="user_confirmed" />
                  <button className="rounded border border-foreground/15 px-2 py-0.5 hover:border-accent">
                    确认
                  </button>
                </form>
              )}
              {canWrite && f.status !== "rejected" && (
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
      {canWrite && <form action={addAction} className="mt-3 flex flex-wrap gap-2">
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
      </form>}
    </section>
  );
}
