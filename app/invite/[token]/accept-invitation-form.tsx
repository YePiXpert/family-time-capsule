"use client";

import { useActionState } from "react";
import { acceptInvitationAction } from "./actions";

const inputClass =
  "min-h-11 rounded-lg border border-foreground/20 bg-background px-3 py-2 text-base outline-none transition-colors focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function AcceptInvitationForm({
  token,
  invitedEmail,
  suggestedName,
}: {
  token: string;
  invitedEmail: string | null;
  suggestedName: string | null;
}) {
  const action = acceptInvitationAction.bind(null, token);
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="mt-7 flex flex-col gap-4">
      {state?.error && (
        <p
          id="accept-invitation-error"
          role="alert"
          tabIndex={-1}
          className="rounded-lg border border-red-800/30 bg-red-500/10 p-3 text-sm leading-6 text-red-800 dark:text-red-300"
        >
          {state.error}
        </p>
      )}
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        显示名称
        <input
          name="displayName"
          type="text"
          required
          maxLength={50}
          autoComplete="name"
          defaultValue={suggestedName ?? ""}
          className={inputClass}
          placeholder="例如：外婆"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        登录邮箱
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="username"
          defaultValue={invitedEmail ?? ""}
          aria-describedby={invitedEmail ? "bound-email-help" : undefined}
          className={inputClass}
        />
        {invitedEmail && (
          <span
            id="bound-email-help"
            className="text-xs font-normal leading-5 text-foreground/60"
          >
            此邀请已限定邮箱，提交时必须与上方地址完全一致（不区分大小写）。
          </span>
        )}
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        密码（至少 10 位）
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
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        确认密码
        <input
          name="passwordConfirm"
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
        disabled={pending}
        aria-describedby={state?.error ? "accept-invitation-error" : undefined}
        className="mt-1 min-h-11 rounded-lg bg-foreground px-5 py-2.5 text-base font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "正在安全创建账号…" : "接受邀请并创建账号"}
      </button>
      <p className="text-xs leading-5 text-foreground/55">
        密码只交给本实例的 Better Auth 哈希器处理，不会以明文写入数据库。
      </p>
    </form>
  );
}
