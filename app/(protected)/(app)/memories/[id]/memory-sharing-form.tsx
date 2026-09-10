"use client";

import { useActionState, useRef, useState } from "react";
import type { EventVisibility } from "@/lib/authz/policy";
import { shareMemoryAction } from "./actions";

type Sharing = { visibility: EventVisibility; readerUserIds: string[]; revision: number };
export function MemorySharingForm({ eventId, visibility, readerUserIds, revision, readers, isAuthor }: {
  eventId: string; visibility: EventVisibility; readerUserIds: string[]; revision: number;
  readers: { id: string; name: string }[]; isAuthor: boolean;
}) {
  const [editing, setEditing] = useState<Sharing | null>(null);
  const [saved, setSaved] = useState(false);
  const mutation = useRef<{ signature: string; id: string } | null>(null);
  const [state, action, pending] = useActionState(async (_: { error?: string } | undefined, data: FormData) => {
    const signature = JSON.stringify([...data.entries()]);
    if (mutation.current?.signature !== signature) mutation.current = { signature, id: crypto.randomUUID() };
    data.set("mutationId", mutation.current.id);
    try {
      const result = await shareMemoryAction(data);
      if (result.saved) { setEditing(null); setSaved(true); }
      return result;
    } catch { return { error: "暂时无法保存分享设置，选择已保留，请重试。" }; }
  }, undefined);
  const label = visibility === "family" ? "全家可见" : visibility === "members" ? "指定家人可见" : isAuthor ? "仅自己" : "仅作者";
  return <section aria-label="记忆分享" className="mt-4 rounded-xl border border-line p-4">
    <p className="text-sm">当前读者：{label}</p>
    {saved ? <p role="status" className="mt-2 text-sm text-accent">分享设置已保存。</p> : null}
    {!editing ? <button type="button" className="ui-button-secondary mt-3" onClick={() => { setSaved(false); setEditing({ visibility, readerUserIds, revision }); }}>管理分享</button> :
      <form action={action} aria-label="修改记忆读者" className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="eventId" value={eventId} /><input type="hidden" name="expectedRevision" value={editing.revision} />
        <label className="flex flex-col gap-1 text-sm">谁可以阅读这件事
          <select disabled={pending} className="ui-input" name="visibility" value={editing.visibility} onChange={e => setEditing(v => v && ({ ...v, visibility: e.target.value as EventVisibility, readerUserIds: [] }))}>
            <option value="private">{isAuthor ? "仅自己" : "仅作者"}</option><option value="members">指定家人</option><option value="family">全家可见</option>
          </select>
        </label>
        {editing.visibility === "members" ? <fieldset className="flex flex-col gap-2"><legend className="text-sm">选择可阅读的家人账号</legend>
          {readers.map(reader => <label key={reader.id} className="flex min-h-11 items-center gap-2 text-sm"><input disabled={pending} type="checkbox" name="readerUserIds" value={reader.id} checked={editing.readerUserIds.includes(reader.id)} onChange={e => setEditing(v => v && ({ ...v, readerUserIds: e.target.checked ? [...v.readerUserIds, reader.id] : v.readerUserIds.filter(id => id !== reader.id) }))} />{reader.name}</label>)}
          {!readers.length ? <p className="text-sm text-muted">暂无可选择的家人账号。</p> : null}
          {editing.readerUserIds.filter(id => !readers.some(reader => reader.id === id)).map(id => <label key={id} className="text-sm"><input disabled={pending} type="checkbox" name="readerUserIds" value={id} checked onChange={() => setEditing(v => v && ({ ...v, readerUserIds: v.readerUserIds.filter(value => value !== id) }))} />已不可用的成员（请取消选择）</label>)}
        </fieldset> : null}
        <p className="text-xs leading-5 text-muted">保存后才会改变读者。移除读者会收回这件事的在线入口；素材在其他记忆中的独立分享仍有效。已导出的文件无法远程收回。家人讲述也遵循各自的阅读范围。</p>
        {state?.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
        <div className="flex gap-2"><button type="submit" disabled={pending} className="ui-button-primary">保存分享设置</button><button type="button" disabled={pending} className="ui-button-secondary" onClick={() => setEditing(null)}>取消</button></div>
      </form>}
  </section>;
}
