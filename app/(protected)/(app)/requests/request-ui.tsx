"use client";

import { useActionState, useState } from "react";
import { closeRequestAction, createRequestAction } from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

export function RequestCreateForm({
  topics,
  people,
  defaultPersonId,
}: {
  topics: Array<{ key: string; label: string; questions: string[] }>;
  people: Array<{ id: string; displayName: string; relationToChild: string | null }>;
  defaultPersonId?: string;
}) {
  const [state, action, pending] = useActionState(createRequestAction, undefined);
  const initialPerson = people.find((person) => person.id === defaultPersonId);
  const [personId, setPersonId] = useState(initialPerson?.id ?? "");
  const [recipientLabel, setRecipientLabel] = useState(
    initialPerson?.relationToChild || initialPerson?.displayName || "",
  );

  if (state?.token) {
    const url = `${window.location.origin}/respond/${state.token}`;
    return (
      <div className="rounded-xl border border-accent/40 bg-background p-4">
        <p className="text-sm font-medium">链接已创建，发送给家人：</p>
        <p className="mt-2 break-all rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2 text-sm">
          {url}
        </p>
        <p className="mt-2 text-xs text-foreground/50">
          有效期至 {state.expiresAt}。家人打开即可回答；提交先进收件箱审核。
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <select
          name="recipientPersonId"
          aria-label="关联家人"
          className={`${inputClass} min-w-32`}
          value={personId}
          onChange={(event) => {
            const nextId = event.target.value;
            setPersonId(nextId);
            const selected = people.find((person) => person.id === nextId);
            if (selected) {
              setRecipientLabel(selected.relationToChild || selected.displayName);
            }
          }}
        >
          <option value="">不关联人物</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.displayName}
              {person.relationToChild ? ` · ${person.relationToChild}` : ""}
            </option>
          ))}
        </select>
        <input
          name="recipientLabel"
          required
          maxLength={50}
          placeholder="称呼，如：外婆"
          aria-label="家人的称呼"
          value={recipientLabel}
          onChange={(event) => setRecipientLabel(event.target.value)}
          className={`${inputClass} min-w-32 flex-1`}
        />
        <select name="topicKey" aria-label="话题" className={inputClass} defaultValue="custom">
          {topics.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
          <option value="custom">自拟问题</option>
        </select>
      </div>
      <textarea
        name="promptText"
        required
        rows={3}
        maxLength={500}
        placeholder="想问这位家人的问题（可以从话题库里选一句改一改）"
        aria-label="问题"
        className={inputClass}
      />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 self-start rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "创建中…" : "创建讲述链接"}
      </button>
      {state?.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function CloseRequestButton({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(closeRequestAction, undefined);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="requestId" value={requestId} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-lg border border-foreground/15 px-3 py-2 text-xs text-foreground/60 hover:border-red-500/40 disabled:opacity-50"
      >
        {pending ? "关闭中…" : "关闭链接"}
      </button>
      {state?.error && (
        <span className="ml-2 text-xs text-red-700 dark:text-red-400">{state.error}</span>
      )}
    </form>
  );
}
