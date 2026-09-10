"use client";

import { OrganizerControl } from "@/components/organizer-control";
import { aiJobFailureMessage } from "@/lib/ai/job-messages";
import { useActionState, useState } from "react";
import type { AssetRow } from "@/lib/assets/service";
import type { AssetTranscriptRow } from "@/db/schema/transcript";
import { aiJob } from "@/db/schema/ai-job";
import {
  editTranscriptAction,
  requestTranscriptionAction,
} from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function StatusLabel({
  transcript,
  job,
}: {
  transcript: AssetTranscriptRow | undefined;
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
      <span className="status-badge status-badge-danger">
        {aiJobFailureMessage(job.lastErrorCode)}
      </span>
    );
  }
  if (!transcript) {
    return (
      <span className="rounded-full border border-foreground/10 px-3 py-1 text-xs text-foreground/50">
        无转录
      </span>
    );
  }
  if (transcript.status === "user_edited") {
    return (
      <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs text-foreground/80">
        已经人工修订
      </span>
    );
  }
  return (
    <span className="rounded-full border border-foreground/10 px-3 py-1 text-xs text-foreground/65">
      AI 生成 · 未确认
    </span>
  );
}

function TranscriptText({
  transcript,
}: {
  transcript: AssetTranscriptRow | undefined;
}) {
  if (!transcript) return null;
  const text = transcript.editedTranscript ?? transcript.rawTranscript;

  return (
    <p className="mt-3 whitespace-pre-wrap leading-7 text-foreground/90">
      {text || (transcript.editedTranscript === null ? "未识别到清晰语音" : "转录已由你清空")}
    </p>
  );
}

function TranscriptSegments({
  transcript,
}: {
  transcript: AssetTranscriptRow | undefined;
}) {
  if (!transcript?.segmentsJson || transcript.editedTranscript !== null) return null;
  let segments: Array<{ startSeconds: number; endSeconds: number; text: string }> = [];
  try {
    const parsed = JSON.parse(transcript.segmentsJson);
    if (Array.isArray(parsed)) segments = parsed;
  } catch {
    return null;
  }
  if (segments.length === 0) return null;
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm text-foreground/60">
        分段时间戳（{segments.length}）
      </summary>
      <ul className="mt-2 flex flex-col gap-2">
        {segments.map((segment, index) => (
          <li
            key={index}
            className="flex gap-3 text-sm"
          >
            <span className="shrink-0 font-mono text-xs text-foreground/50">
              {formatSeconds(segment.startSeconds)}–
              {formatSeconds(segment.endSeconds)}
            </span>
            <span className="text-foreground/80">{segment.text}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function TranscriptSection({
  memoryEventId,
  asset,
  transcript,
  job,
  canRequest,
  canEdit,
}: {
  memoryEventId: string;
  asset: AssetRow;
  transcript: AssetTranscriptRow | undefined;
  job: typeof aiJob.$inferSelect | undefined;
  canRequest: boolean;
  canEdit: boolean;
}) {
  const [requestState, requestAction, requesting] = useActionState(
    requestTranscriptionAction,
    undefined,
  );
  const busy = requesting;

  return (
    <article className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        {/* 文件名不是章节标题：避免与事件标题的 heading 角色撞名（可访问性/测试稳定性） */}
        <p className="text-sm font-medium">{asset.originalFilename}</p>
        <StatusLabel transcript={transcript} job={job} />
      </header>

      {canEdit ? <OrganizerControl kind="asset" id={asset.id} reviewNames={false} /> : null}
      <TranscriptText transcript={transcript} />
      <TranscriptSegments transcript={transcript} />

      {canRequest && (
        <form action={requestAction} className="mt-4">
          <input type="hidden" name="assetId" value={asset.id} />
          <input type="hidden" name="memoryEventId" value={memoryEventId} />
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {requesting ? "请求中…" : "AI 转录"}
          </button>
          {requestState?.error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {requestState.error}
            </p>
          )}
          {requestState?.success && (
            <p role="status" className="mt-2 text-sm text-foreground/70">
              {requestState.success}
            </p>
          )}
        </form>
      )}

      {canEdit ? <TranscriptEditor asset={asset} memoryEventId={memoryEventId} transcript={transcript} /> : null}

    </article>
  );
}


function TranscriptEditor({ asset, memoryEventId, transcript }: { asset: AssetRow; memoryEventId: string; transcript: AssetTranscriptRow | undefined }) {
  const [draft, setDraft] = useState({ text: transcript?.editedTranscript ?? transcript?.rawTranscript ?? "", revision: transcript?.revision ?? null });
  const [editState, editAction, editing] = useActionState(async (previous: import("./actions").TranscriptActionState | undefined, formData: FormData) => {
    const result = await editTranscriptAction(previous, formData);
    if (result.savedRevision !== undefined) setDraft(current => current.revision === (formData.get("revision") === "none" ? null : Number(formData.get("revision"))) ? { ...current, revision: result.savedRevision! } : current);
    return result;
  }, undefined);
  return (
        <form action={editAction} className="mt-4 flex flex-col gap-2">
          <input type="hidden" name="revision" value={draft.revision ?? "none"} />
          <input type="hidden" name="assetId" value={asset.id} />
          <input type="hidden" name="memoryEventId" value={memoryEventId} />
          {(transcript?.revision ?? null) !== draft.revision ? <p className="text-sm text-muted">转录已有新版本；当前输入和原编辑版本已保留。<button type="button" className="ui-button-secondary" onClick={() => setDraft({ text: transcript?.editedTranscript ?? transcript?.rawTranscript ?? "", revision: transcript?.revision ?? null })}>载入最新转录</button></p> : null}
          <textarea
            name="editedText"
            value={draft.text}
            onChange={event => setDraft({ ...draft, text: event.target.value })}
            rows={4}
            maxLength={200_000}
            className={inputClass}
            aria-label={`修订 ${asset.originalFilename} 的转录`}
          />
          <button
            type="submit"
            disabled={editing || (transcript?.revision ?? null) !== draft.revision}
            className="self-start rounded-lg border border-foreground/15 px-3 py-1.5 text-xs transition-colors hover:border-accent disabled:opacity-50"
          >
            {editing ? "保存中…" : "保存修订"}
          </button>
          {editState?.error && (
            <p role="alert" className="text-xs text-danger">
              {editState.error}
            </p>
          )}
          {editState?.success && (
            <p role="status" className="text-xs text-foreground/70">
              {editState.success}
            </p>
          )}
        </form>
  );
}
