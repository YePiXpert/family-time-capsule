"use client";

import { useActionState } from "react";
import { bindRestoredAction } from "./bind-action";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-base outline-none transition-colors focus:border-accent";

export function BindRestoredForm({
  people,
}: {
  people: Array<{ id: string; displayName: string; relationToChild: string | null }>;
}) {
  const [state, formAction, pending] = useActionState(bindRestoredAction, undefined);
  const candidates = people.filter((p) => true); // 服务端已校验 isChild；UI 允许全部显示但提交校验

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-4">
      {state?.error && (
        <p role="alert" className="rounded-lg border border-red-800/30 bg-red-500/10 p-3 text-sm">
          {state.error}
        </p>
      )}
      <p className="text-sm leading-6 text-foreground/60">
        这个账号是刚恢复的档案的管理员。请选择你在家庭里是哪一位——
        时间轴、视角与胶囊都会按原有内容继续。
      </p>
      <label className="flex flex-col gap-1.5 text-sm">
        你是
        <select name="personId" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            选择成员
          </option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
              {p.relationToChild && p.relationToChild !== p.displayName
                ? `（${p.relationToChild}）`
                : ""}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-foreground px-4 py-2.5 text-background transition-opacity disabled:opacity-50"
      >
        {pending ? "绑定中…" : "进入家庭"}
      </button>
    </form>
  );
}
