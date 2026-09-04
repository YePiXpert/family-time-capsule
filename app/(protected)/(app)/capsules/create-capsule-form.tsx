"use client";

import { useActionState, useState } from "react";
import { createCapsuleAction } from "./actions";

const inputClass =
  "min-h-11 rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

export function CreateCapsuleForm() {
  const [state, formAction, pending] = useActionState(createCapsuleAction, undefined);
  const [unlockType, setUnlockType] = useState<"date" | "age">("date");

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      {state?.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm">
        胶囊标题
        <input
          name="title"
          type="text"
          required
          maxLength={100}
          placeholder="例如：写给一岁的你"
          className={inputClass}
        />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          开启条件
          <select
            name="unlockType"
            value={unlockType}
            onChange={(e) => setUnlockType(e.target.value as "date" | "age")}
            className={inputClass}
          >
            <option value="date">到某一天</option>
            <option value="age">孩子到某岁</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {unlockType === "date" ? "开启日期" : "开启年龄（岁）"}
          {unlockType === "date" ? (
            <input name="unlockValue" type="date" required className={inputClass} />
          ) : (
            <input
              name="unlockValue"
              type="number"
              min={1}
              max={100}
              required
              placeholder="18"
              className={inputClass}
            />
          )}
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 self-start rounded-lg border border-foreground/20 px-4 py-2 text-sm transition-colors hover:border-accent disabled:opacity-50"
      >
        {pending ? "创建中…" : "创建胶囊"}
      </button>
    </form>
  );
}
