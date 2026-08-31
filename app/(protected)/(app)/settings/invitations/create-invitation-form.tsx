"use client";

import { useActionState } from "react";
import type { InvitationPersonCandidate } from "@/lib/invitations/service";
import { createInvitationAction } from "./actions";

const inputClass =
  "min-h-11 rounded-lg border border-foreground/20 bg-background px-3 py-2 text-base outline-none transition-colors focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function CreateInvitationForm({
  people,
}: {
  people: InvitationPersonCandidate[];
}) {
  const [state, formAction, pending] = useActionState(
    createInvitationAction,
    undefined,
  );

  return (
    <form action={formAction} className="mt-5 flex flex-col gap-4">
      {state?.error && (
        <p
          id="create-invitation-error"
          role="alert"
          className="rounded-lg border border-red-800/30 bg-red-500/10 p-3 text-sm leading-6 text-red-800 dark:text-red-300"
        >
          {state.error}
        </p>
      )}
      {state?.invitePath && (
        <div
          role="status"
          className="rounded-xl border border-accent/40 bg-accent/10 p-4"
        >
          <p className="font-medium">邀请已创建</p>
          <p className="mt-1 text-sm leading-6 text-foreground/70">
            这个链接只显示这一次。请通过可信渠道发给受邀者；不要发送到公开群组。
          </p>
          <a
            href={state.invitePath}
            className="mt-3 block min-h-11 overflow-wrap-anywhere rounded-lg border border-foreground/15 bg-background px-3 py-2 font-mono text-sm leading-6 underline decoration-foreground/30 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            style={{ overflowWrap: "anywhere" }}
          >
            {state.invitePath}
          </a>
          {state.expiresAt && (
            <p className="mt-2 text-xs leading-5 text-foreground/60">
              有效至 {new Intl.DateTimeFormat("zh-CN", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(state.expiresAt))}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          账号角色
          <select name="role" defaultValue="viewer" className={inputClass}>
            <option value="viewer">查看者 · 只读</option>
            <option value="contributor">贡献者 · 添加自己的内容</option>
            <option value="editor">编辑者 · 整理记忆与故事</option>
            <option value="admin">管理员 · 完整管理权限</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          有效期
          <select
            name="expiresInDays"
            defaultValue="7"
            className={inputClass}
          >
            <option value="1">1 天</option>
            <option value="3">3 天</option>
            <option value="7">7 天</option>
            <option value="14">14 天</option>
            <option value="30">30 天</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        限定邮箱（可选）
        <input
          name="email"
          type="email"
          autoComplete="off"
          maxLength={254}
          className={inputClass}
          aria-describedby="invite-email-help"
          placeholder="例如：grandma@example.com"
        />
        <span
          id="invite-email-help"
          className="text-xs font-normal leading-5 text-foreground/60"
        >
          填写后，只有完全相同的邮箱才能接受邀请。
        </span>
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        绑定家人档案（可选）
        <select name="personId" defaultValue="" className={inputClass}>
          <option value="">暂不绑定</option>
          {people.map((member) => (
            <option key={member.id} value={member.id}>
              {member.displayName}
              {member.relationToChild
                ? ` · ${member.relationToChild}`
                : ""}
            </option>
          ))}
        </select>
        <span className="text-xs font-normal leading-5 text-foreground/60">
          Person 是现实中的家人；账号只是登录身份。没有账号的家人档案仍会保留。
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        aria-describedby={state?.error ? "create-invitation-error" : undefined}
        className="min-h-11 self-start rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "正在安全创建…" : "创建邀请链接"}
      </button>
    </form>
  );
}
