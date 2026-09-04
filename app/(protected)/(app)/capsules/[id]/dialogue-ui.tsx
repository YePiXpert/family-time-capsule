"use client";

import { useActionState } from "react";
import {
  addQuestionAction,
  addReplyAction,
  removeQuestionAction,
  type DialogueActionState,
} from "./dialogue-actions";

const inputClass =
  "min-h-11 rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

function Feedback({ state }: { state: DialogueActionState | undefined }) {
  if (!state) return null;
  return (
    <>
      {state.error && (
        <span role="alert" className="text-xs text-red-700 dark:text-red-400">
          {state.error}
        </span>
      )}
      {state.message && (
        <span role="status" className="text-xs text-foreground/70">
          {state.message}
        </span>
      )}
    </>
  );
}

/** draft 阶段添加未来问题 */
export function AddQuestionForm({ capsuleId }: { capsuleId: string }) {
  const [state, action, pending] = useActionState(addQuestionAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="capsuleId" value={capsuleId} />
      <textarea
        name="questionText"
        required
        rows={2}
        maxLength={500}
        placeholder="想问未来的他/她什么？如：十八岁的你，现在最看重什么？"
        aria-label="新的未来问题"
        className={inputClass}
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded border border-foreground/15 px-3 py-2 text-xs hover:border-accent disabled:opacity-50"
        >
          {pending ? "添加中…" : "添加问题"}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function RemoveQuestionButton({
  capsuleId,
  questionId,
}: {
  capsuleId: string;
  questionId: string;
}) {
  const [state, action, pending] = useActionState(removeQuestionAction, undefined);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="capsuleId" value={capsuleId} />
      <input type="hidden" name="questionId" value={questionId} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded border border-foreground/10 px-3 py-2 text-xs text-foreground/50 hover:border-red-500/40 disabled:opacity-50"
      >
        删除
      </button>
      <Feedback state={state} />
    </form>
  );
}

/** 解锁后回答问题 */
export function ReplyForm({
  capsuleId,
  questionId,
}: {
  capsuleId: string;
  questionId: string;
}) {
  const [state, action, pending] = useActionState(addReplyAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="capsuleId" value={capsuleId} />
      <input type="hidden" name="questionId" value={questionId} />
      <textarea
        name="text"
        rows={3}
        maxLength={10000}
        placeholder="写下此刻的回答…"
        aria-label="回答"
        className={inputClass}
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          name="file"
          accept="audio/*,video/*,image/*"
          aria-label="附加录音、照片或视频（可选）"
          className="text-xs"
        />
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-lg bg-foreground px-3 py-2 text-xs text-background transition-opacity disabled:opacity-50"
        >
          {pending ? "提交中…" : "回答"}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}
