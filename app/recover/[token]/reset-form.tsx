"use client";

import Link from "next/link";
import { useActionState } from "react";
import { resetPasswordAction } from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-base outline-none transition-colors focus:border-accent";

export function ResetForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    resetPasswordAction,
    undefined,
  );
  if (state?.success) {
    return (
      <div className="mt-8 flex flex-col gap-4">
        <p
          role="status"
          className="rounded-lg border border-emerald-700/30 bg-emerald-500/10 p-3 text-sm leading-6"
        >
          {state.success}
        </p>
        <Link
          href="/login"
          className="rounded-lg bg-foreground px-4 py-2.5 text-center text-background"
        >
          去登录
        </Link>
      </div>
    );
  }
  return (
    <form action={formAction} className="mt-8 flex flex-col gap-4">
      {state?.error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-800/30 bg-red-500/10 p-3 text-sm"
        >
          {state.error}
        </p>
      ) : null}
      <input type="hidden" name="token" value={token} />
      <label className="flex flex-col gap-1.5 text-sm">
        新密码（至少 10 位）
        <input
          name="password"
          type="password"
          required
          minLength={10}
          maxLength={128}
          autoComplete="new-password"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        再输入一次
        <input
          name="confirm"
          type="password"
          required
          minLength={10}
          maxLength={128}
          autoComplete="new-password"
          className={inputClass}
        />
      </label>
      <button
        type="submit"
        disabled={pending || token.length === 0}
        className="mt-2 rounded-lg bg-foreground px-4 py-2.5 text-background transition-opacity disabled:opacity-50"
      >
        {pending ? "提交中…" : "设置新密码"}
      </button>
    </form>
  );
}
