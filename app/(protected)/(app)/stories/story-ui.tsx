"use client";

import { useActionState } from "react";
import {
  createDeterministicDraftAction,
  requestGenerationAction,
  regenerateDraftAction,
  updateTitleAction,
  updateParagraphAction,
  deleteParagraphAction,
  addParagraphAction,
  publishStoryAction,
  type StoryActionState,
} from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

const KIND_OPTIONS = [
  { value: "weekly", label: "周记" },
  { value: "monthly", label: "月章" },
  { value: "yearly", label: "年章" },
] as const;

function Feedback({ state }: { state: StoryActionState | undefined }) {
  if (!state) return null;
  return (
    <>
      {state.error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-xs text-foreground/70">
          {state.message}
        </p>
      )}
    </>
  );
}

export function StoryCreateForms({ canAi }: { canAi: boolean }) {
  const [offlineState, offlineAction, offlinePending] = useActionState(
    createDeterministicDraftAction,
    undefined,
  );
  const [aiState, aiAction, aiPending] = useActionState(
    requestGenerationAction,
    undefined,
  );
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section
      aria-label="生成故事草稿"
      className="mt-6 rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4"
    >
      <h2 className="text-base font-medium">新的故事</h2>
      <p className="mt-1 text-xs leading-5 text-foreground/50">
        离线组装只使用本地已确认内容（事实 + 家人讲述 + 人工修订转录），不需要 AI；
        AI 起草会由 worker 异步生成，同样只基于已确认来源。
      </p>
      <div className="mt-3 flex flex-wrap items-start gap-3">
        <form action={offlineAction} className="flex flex-wrap items-center gap-2">
          <select name="kind" aria-label="故事类型" className={inputClass} defaultValue="weekly">
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            name="anchor"
            required
            defaultValue={today}
            aria-label="时间段内的任一天"
            className={inputClass}
          />
          <button
            type="submit"
            disabled={offlinePending}
            className="rounded-lg bg-foreground px-3 py-1.5 text-xs text-background transition-opacity disabled:opacity-50"
          >
            {offlinePending ? "组装中…" : "离线组装草稿"}
          </button>
          <Feedback state={offlineState} />
        </form>
        {canAi && (
          <form action={aiAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="kind" value="weekly" />
            <input type="hidden" name="anchor" value={today} />
            <button
              type="submit"
              disabled={aiPending}
              className="rounded-lg border border-foreground/20 px-3 py-1.5 text-xs transition-colors hover:border-accent disabled:opacity-50"
            >
              {aiPending ? "请求中…" : "AI 起草本周"}
            </button>
            <Feedback state={aiState} />
          </form>
        )}
      </div>
    </section>
  );
}

export function RegenerateButton({
  kind,
  anchor,
}: {
  kind: string;
  anchor: string;
}) {
  const [state, action, pending] = useActionState(
    regenerateDraftAction,
    undefined,
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="anchor" value={anchor} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-foreground/20 px-3 py-1.5 text-xs transition-colors hover:border-accent disabled:opacity-50"
      >
        {pending ? "再生成中…" : "重新生成草稿"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function TitleEditForm({
  storyId,
  title,
}: {
  storyId: string;
  title: string;
}) {
  const [state, action, pending] = useActionState(updateTitleAction, undefined);
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="storyId" value={storyId} />
      <input
        name="title"
        defaultValue={title}
        maxLength={100}
        required
        aria-label="故事标题"
        className={`${inputClass} min-w-48 flex-1`}
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-foreground/20 px-3 py-1.5 text-xs transition-colors hover:border-accent disabled:opacity-50"
      >
        {pending ? "保存中…" : "改标题"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function ParagraphEditor({
  storyId,
  paragraphId,
  kind,
  text,
}: {
  storyId: string;
  paragraphId: string;
  kind: string;
  text: string;
}) {
  const [editState, editAction, editPending] = useActionState(
    updateParagraphAction,
    undefined,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteParagraphAction,
    undefined,
  );

  return (
    <div className="mt-2 flex flex-col gap-1">
      {kind === "narrative" ? (
        <form action={editAction} className="flex flex-col gap-1">
          <input type="hidden" name="storyId" value={storyId} />
          <input type="hidden" name="paragraphId" value={paragraphId} />
          <textarea
            name="text"
            defaultValue={text}
            rows={3}
            maxLength={2000}
            aria-label="编辑叙述段落"
            className={inputClass}
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={editPending}
              className="self-start rounded border border-foreground/15 px-2 py-1 text-xs hover:border-accent disabled:opacity-50"
            >
              {editPending ? "保存中…" : "保存段落"}
            </button>
            <Feedback state={editState} />
          </div>
        </form>
      ) : (
        <p className="text-xs text-foreground/45">
          引文段落：逐字来自原始讲述，不可编辑（可删除）。
        </p>
      )}
      <form action={deleteAction} className="flex items-center gap-2">
        <input type="hidden" name="storyId" value={storyId} />
        <input type="hidden" name="paragraphId" value={paragraphId} />
        <button
          type="submit"
          disabled={deletePending}
          className="self-start rounded border border-foreground/10 px-2 py-1 text-xs text-foreground/60 hover:border-red-500/40 disabled:opacity-50"
        >
          {deletePending ? "删除中…" : "删除段落"}
        </button>
        <Feedback state={deleteState} />
      </form>
    </div>
  );
}

export function AddParagraphForm({ storyId }: { storyId: string }) {
  const [state, action, pending] = useActionState(addParagraphAction, undefined);
  return (
    <form action={action} className="mt-4 flex flex-col gap-1">
      <input type="hidden" name="storyId" value={storyId} />
      <textarea
        name="text"
        rows={2}
        maxLength={2000}
        required
        placeholder="补写一段家人的话（不允许引号字符；直接引语请从讲述原文生成）"
        aria-label="新增手写段落"
        className={inputClass}
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-foreground/15 px-2 py-1 text-xs hover:border-accent disabled:opacity-50"
        >
          {pending ? "添加中…" : "添加段落"}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function PublishForm({ storyId }: { storyId: string }) {
  const [state, action, pending] = useActionState(publishStoryAction, undefined);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="storyId" value={storyId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-foreground px-3 py-1.5 text-xs text-background transition-opacity disabled:opacity-50"
      >
        {pending ? "发布中…" : "发布故事"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
