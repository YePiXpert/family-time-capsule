"use client";

import { useActionState } from "react";
import { setupAction } from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-base outline-none transition-colors focus:border-accent";

export function SetupForm() {
  const [state, formAction, pending] = useActionState(setupAction, undefined);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-4">
      {state?.error && (
        <p
          role="alert"
          className="rounded-lg border border-red-800/30 bg-red-500/10 p-3 text-sm"
        >
          {state.error}
        </p>
      )}
      <label className="flex flex-col gap-1.5 text-sm">
        初始化令牌
        <input
          name="token"
          type="password"
          required
          autoComplete="off"
          className={inputClass}
          placeholder="服务器配置的 INITIAL_SETUP_TOKEN"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        显示名称
        <input
          name="displayName"
          type="text"
          required
          maxLength={50}
          className={inputClass}
          placeholder="例如：爸爸"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        邮箱（登录用）
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        密码（至少 10 位）
        <input
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        确认密码
        <input
          name="passwordConfirm"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className={inputClass}
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-lg bg-foreground px-4 py-2.5 text-background transition-opacity disabled:opacity-50"
      >
        {pending ? "创建中…" : "创建管理员"}
      </button>
    </form>
  );
}
