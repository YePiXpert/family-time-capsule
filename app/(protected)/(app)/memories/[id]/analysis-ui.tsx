"use client";

import { useActionState } from "react";
import type { AssetRow } from "@/lib/assets/service";
import type { AssetAnalysisRow } from "@/db/schema/analysis";
import { aiJob } from "@/db/schema/ai-job";
import { requestImageAnalysisAction, requestVideoAnalysisAction } from "./actions";

function StatusLabel({
  analysis,
  job,
}: {
  analysis: AssetAnalysisRow | undefined;
  job: typeof aiJob.$inferSelect | undefined;
}) {
  if (job?.status === "pending" || job?.status === "running") {
    return (
      <span className="rounded-full border border-foreground/10 px-3 py-1 text-xs text-foreground/65">
        处理中
      </span>
    );
  }
  if (job?.status === "failed") {
    return (
      <span className="rounded-full border border-red-800/30 px-3 py-1 text-xs text-red-800 dark:text-red-300">
        失败可重试
      </span>
    );
  }
  if (!analysis) {
    return (
      <span className="rounded-full border border-foreground/10 px-3 py-1 text-xs text-foreground/50">
        无分析
      </span>
    );
  }
  return (
    <span className="rounded-full border border-foreground/10 px-3 py-1 text-xs text-foreground/65">
      AI 生成 · 未确认
    </span>
  );
}

function AnalysisCard({
  analysis,
}: {
  analysis: AssetAnalysisRow | undefined;
}) {
  if (!analysis) return null;
  return (
    <div className="mt-4 rounded-lg border border-foreground/10 bg-foreground/[0.025] p-4">
      <p className="text-xs font-medium text-foreground/50">AI 生成 · 未确认</p>
      <p className="mt-2 whitespace-pre-wrap leading-7 text-foreground/90">
        {analysis.description}
      </p>
      {analysis.ocrText && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-foreground/60">
            图中文字
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/80">
            {analysis.ocrText}
          </p>
        </details>
      )}
    </div>
  );
}

export function ImageAnalysisSection({
  memoryEventId,
  asset,
  analysis,
  job,
  canRequest,
  kind = "image",
}: {
  memoryEventId: string;
  asset: AssetRow;
  analysis: AssetAnalysisRow | undefined;
  job: typeof aiJob.$inferSelect | undefined;
  /** image = 图片视觉分析；video = ffmpeg 抽帧后的视频理解（M3-G） */
  kind?: "image" | "video";
  canRequest: boolean;
}) {
  const [imageState, imageAction, imagePending] = useActionState(
    requestImageAnalysisAction,
    undefined,
  );
  const [videoState, videoAction, videoPending] = useActionState(
    requestVideoAnalysisAction,
    undefined,
  );
  const state = kind === "video" ? videoState : imageState;
  const action = kind === "video" ? videoAction : imageAction;
  const pending = kind === "video" ? videoPending : imagePending;

  return (
    <article className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        {/* 文件名不是章节标题：避免与事件标题的 heading 角色撞名（可访问性/测试稳定性） */}
        <p className="text-sm font-medium">{asset.originalFilename}</p>
        <StatusLabel analysis={analysis} job={job} />
      </header>

      <AnalysisCard analysis={analysis} />

      {canRequest && (
        <form action={action} className="mt-4">
          <input type="hidden" name="assetId" value={asset.id} />
          <input type="hidden" name="memoryEventId" value={memoryEventId} />
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "请求中…" : kind === "video" ? "生成视频理解" : "生成 AI 描述"}
          </button>
          {kind === "video" && (
            <p className="mt-1 text-xs text-foreground/45">
              由服务器抽取少量代表帧送 AI 分析；需要 ffmpeg（缺失时此功能不可用，原件不受影响）。
            </p>
          )}
          {state?.error && (
            <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
              {state.error}
            </p>
          )}
          {state?.success && (
            <p role="status" className="mt-2 text-sm text-foreground/70">
              {state.success}
            </p>
          )}
        </form>
      )}
    </article>
  );
}
