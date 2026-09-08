"use client";

import { useActionState, useRef, useState } from "react";
import { editReviewMemoryAction } from "../actions";

export function ReviewMemoryForm({ event, periodKey, people, milestones }: {
  event: { id: string; title: string; titleRevision: number; locationText: string | null; milestoneType: string | null; participantPersonIds: string[] };
  periodKey: string;
  people: { id: string; displayName: string }[];
  milestones: readonly (readonly [string, string])[];
}) {
  const [values, setValues] = useState({ title: event.title, location: event.locationText ?? "", milestone: event.milestoneType ?? "", participants: event.participantPersonIds });
  const [revision, setRevision] = useState(event.titleRevision);
  const mutation = useRef<{ signature: string; id: string } | null>(null);
  const [state, action, pending] = useActionState(async (_: { error?: string; saved?: boolean } | undefined, data: FormData) => {
    const signature = JSON.stringify([...data.entries()]);
    if (mutation.current?.signature !== signature) mutation.current = { signature, id: crypto.randomUUID() };
    data.set("mutationId", mutation.current.id);
    try {
      const result = await editReviewMemoryAction(data);
      if (result.revision !== undefined) setRevision(result.revision);
      return result;
    } catch { return { error: "暂时无法保存，输入已保留，请重试。" }; }
  }, undefined);
  return <form action={action} aria-label="补充真实信息" className="mt-3 grid gap-3 sm:grid-cols-2">
    <input type="hidden" name="eventId" value={event.id} /><input type="hidden" name="periodKey" value={periodKey} />
    <input type="hidden" name="expectedRevision" value={revision} />
    <input className="ui-input" name="title" maxLength={100} required value={values.title} onChange={e => setValues(v => ({ ...v, title: e.target.value }))} aria-label="标题" />
    <input className="ui-input" name="locationText" maxLength={200} value={values.location} onChange={e => setValues(v => ({ ...v, location: e.target.value }))} aria-label="地点" />
    <select className="ui-input" name="milestoneType" value={values.milestone} onChange={e => setValues(v => ({ ...v, milestone: e.target.value }))} aria-label="成长节点">
      {milestones.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    <fieldset className="rounded-xl border border-line p-3"><legend className="px-1 text-xs text-muted">人物</legend>{people.map(person => <label key={person.id} className="mr-3 inline-flex items-center gap-1 text-sm"><input type="checkbox" name="participantPersonId" value={person.id} checked={values.participants.includes(person.id)} onChange={e => setValues(v => ({ ...v, participants: e.target.checked ? [...v.participants, person.id] : v.participants.filter(id => id !== person.id) }))} />{person.displayName}</label>)}</fieldset>
    {state?.error ? <p role="alert">{state.error}</p> : state?.saved ? <p role="status">已保存人工补充。</p> : null}
    <button className="ui-button-secondary sm:col-span-2" disabled={pending} type="submit">保存人工补充</button>
  </form>;
}
