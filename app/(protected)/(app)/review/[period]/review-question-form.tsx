"use client";

import { useActionState, useState } from "react";
import { createReviewQuestionAction } from "../actions";

export function ReviewQuestionForm({
  eventTitle,
  periodKey,
  people,
}: {
  eventTitle: string;
  periodKey: string;
  people: Array<{ id: string; displayName: string; relationToChild: string | null }>;
}) {
  const [state, action, pending] = useActionState(createReviewQuestionAction, undefined);
  const [personId, setPersonId] = useState(people[0]?.id ?? "");
  const selected = people.find((person) => person.id === personId);
  if (state?.token) {
    const link = `${window.location.origin}/respond/${state.token}`;
    return <div className="mt-3 rounded-lg border border-accent/30 bg-accent-soft p-3"><p className="text-xs font-medium">安全回答链接（只显示这一次）</p><p className="mt-1 break-all text-xs" data-testid="review-answer-link">{link}</p></div>;
  }
  return <form action={action} className="mt-3 space-y-2">
    <input type="hidden" name="periodKey" value={periodKey} />
    <input type="hidden" name="recipientLabel" value={selected?.relationToChild || selected?.displayName || "家人"} />
    <input type="hidden" name="promptText" value={`关于“${eventTitle}”，你最想替家里记住什么？`} />
    <select className="ui-input w-full" name="recipientPersonId" value={personId} onChange={(event) => setPersonId(event.target.value)} aria-label={`选择回答“${eventTitle}”的家人`}>
      {people.map((person) => <option key={person.id} value={person.id}>{person.displayName}{person.relationToChild ? ` · ${person.relationToChild}` : ""}</option>)}
    </select>
    <button className="ui-button-secondary" disabled={pending || !personId} type="submit">{pending ? "创建中…" : "生成回答链接"}</button>
    {state?.error ? <p className="text-xs text-red-700" role="alert">{state.error}</p> : null}
  </form>;
}
