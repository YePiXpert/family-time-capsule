"use client";

import { useActionState } from "react";
import { addPersonAction } from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-base outline-none transition-colors focus:border-accent";

export function AddPersonForm() {
  const [state, formAction, pending] = useActionState(addPersonAction, undefined);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      {state?.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm">
          姓名
          <input
            name="displayName"
            type="text"
            required
            maxLength={50}
            className={inputClass}
            placeholder="例如：外婆"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          对孩子的称谓
          <input
            name="relationToChild"
            type="text"
            maxLength={20}
            className={inputClass}
            placeholder="例如：外婆"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          出生日期（可选）
          <input name="birthDate" type="date" className={inputClass} />
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg border border-foreground/20 px-4 py-2 text-sm transition-colors hover:border-accent disabled:opacity-50"
      >
        {pending ? "添加中…" : "添加家人"}
      </button>
    </form>
  );
}
