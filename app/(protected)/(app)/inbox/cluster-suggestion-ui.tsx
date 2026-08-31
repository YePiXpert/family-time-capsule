"use client";

import { useActionState } from "react";
import {
  scanClustersAction,
  resolveClusterAction,
  type ClusterActionState,
  type SuggestionActionState,
} from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

const KIND_LABEL: Record<string, string> = {
  time_proximity: "时间相近",
  similar_media: "画面相似",
  live_photo_pair: "Live Photo",
};

export type ClusterSuggestionDto = {
  id: string;
  kind: string;
  reasonText: string;
  /** 成员摘要（文件名/文字开头） */
  memberLabels: string[];
};

/** M3-F：本地聚类建议面板——接受才走既有合并，绝不自动合并/删除 */
export function ClusterSuggestionPanel({
  suggestions,
}: {
  suggestions: ClusterSuggestionDto[];
}) {
  const [scanState, scanActionRun, scanPending] = useActionState(
    scanClustersAction,
    undefined as SuggestionActionState | undefined,
  );

  return (
    <section
      aria-label="分簇建议"
      className="mt-8 rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-medium">分簇建议</h2>
          <p className="mt-1 text-xs leading-5 text-foreground/50">
            完全在本地计算（时间相近 / 画面相似 / Live Photo 配对），不依赖 AI；
            只有你点「合并成一个事件」才会执行，永不自动合并或删除原件。
          </p>
        </div>
        <form action={scanActionRun}>
          <button
            type="submit"
            disabled={scanPending}
            className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm transition-colors hover:border-accent disabled:opacity-50"
          >
            {scanPending ? "扫描中…" : "扫描分簇"}
          </button>
        </form>
      </div>
      {scanState?.message && (
        <p role="status" className="mt-2 text-sm text-foreground/70">
          {scanState.message}
        </p>
      )}
      {scanState?.error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {scanState.error}
        </p>
      )}

      {suggestions.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3" aria-label="分簇建议列表">
          {suggestions.map((s) => (
            <ClusterRow key={s.id} cluster={s} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ClusterRow({ cluster }: { cluster: ClusterSuggestionDto }) {
  const [state, action, pending] = useActionState(
    resolveClusterAction,
    undefined as ClusterActionState | undefined,
  );

  return (
    <li className="rounded-lg border border-foreground/10 px-4 py-3 text-sm">
      <p>
        <span className="rounded border border-foreground/15 px-1.5 py-0.5 text-xs text-foreground/60">
          {KIND_LABEL[cluster.kind] ?? cluster.kind}
        </span>
        <span className="ml-2">{cluster.reasonText}</span>
      </p>
      <p className="mt-1 text-xs leading-5 text-foreground/50">
        成员：{cluster.memberLabels.join("、")}
      </p>
      <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="suggestionId" value={cluster.id} />
        <input
          type="text"
          name="title"
          maxLength={100}
          placeholder="合并后的事件标题（可留空自动生成）"
          aria-label="分簇合并事件标题"
          className={`${inputClass} min-w-40 flex-1`}
        />
        <button
          type="submit"
          name="action"
          value="accept"
          disabled={pending}
          className="rounded-lg bg-foreground px-3 py-1.5 text-xs text-background transition-opacity disabled:opacity-50"
        >
          {pending ? "处理中…" : "合并成一个事件"}
        </button>
        <button
          type="submit"
          name="action"
          value="dismiss"
          disabled={pending}
          className="rounded-lg border border-foreground/15 px-3 py-1.5 text-xs text-foreground/60 transition-colors hover:border-red-500/40 disabled:opacity-50"
        >
          不是一件事
        </button>
        {state?.error && (
          <span className="text-xs text-red-700 dark:text-red-400">
            {state.error}
          </span>
        )}
      </form>
    </li>
  );
}
