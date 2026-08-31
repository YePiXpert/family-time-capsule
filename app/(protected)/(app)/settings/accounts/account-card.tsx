"use client";

import { useActionState } from "react";
import type { FamilyAccountDto } from "@/lib/accounts/service";
import {
  changeAccountRoleAction,
  disableAccountAction,
  enableAccountAction,
} from "./actions";

const ROLE_LABEL = {
  admin: "管理员",
  editor: "编辑者",
  contributor: "贡献者",
  viewer: "查看者",
} as const;

const inputClass =
  "min-h-11 rounded-lg border border-foreground/20 bg-background px-3 py-2 text-base outline-none transition-colors focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60";

function ResultMessage({
  state,
}: {
  state: { error?: string; success?: string } | undefined;
}) {
  if (!state?.error && !state?.success) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      className={
        state.error
          ? "text-sm leading-6 text-red-700 dark:text-red-300"
          : "text-sm leading-6 text-emerald-700 dark:text-emerald-300"
      }
    >
      {state.error ?? state.success}
    </p>
  );
}

export function AccountCard({ account }: { account: FamilyAccountDto }) {
  const roleAction = changeAccountRoleAction.bind(null, account.id);
  const stateAction = (
    account.disabledAt ? enableAccountAction : disableAccountAction
  ).bind(null, account.id);
  const [roleState, roleFormAction, rolePending] = useActionState(
    roleAction,
    undefined,
  );
  const [accountState, accountFormAction, accountPending] = useActionState(
    stateAction,
    undefined,
  );

  return (
    <li className="rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">{account.name}</h2>
            {account.isCurrentUser && (
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs">
                当前账号
              </span>
            )}
            <span
              className={
                account.disabledAt
                  ? "rounded-full border border-red-700/25 bg-red-500/10 px-2 py-0.5 text-xs text-red-800 dark:text-red-300"
                  : "rounded-full border border-emerald-700/25 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-800 dark:text-emerald-300"
              }
            >
              {account.disabledAt ? "已停用" : "可登录"}
            </span>
          </div>
          <p className="mt-1 break-all text-sm text-foreground/60">
            {account.email}
          </p>
          <p className="mt-1 text-sm text-foreground/60">
            家人档案：{account.personName ?? "未绑定"}
          </p>
        </div>
        <span className="text-sm text-foreground/60">
          {ROLE_LABEL[account.role]}
        </span>
      </div>

      <div className="mt-5 grid gap-5 border-t border-foreground/10 pt-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <form action={roleFormAction} className="flex min-w-0 flex-col gap-2">
          <label
            htmlFor={`role-${account.id}`}
            className="text-sm font-medium"
          >
            账号角色
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              id={`role-${account.id}`}
              name="role"
              defaultValue={account.role}
              disabled={rolePending}
              className={`${inputClass} min-w-0 flex-1`}
            >
              <option value="viewer">查看者 · 只读</option>
              <option value="contributor">贡献者 · 添加自己的内容</option>
              <option value="editor">编辑者 · 整理家庭内容</option>
              <option value="admin">管理员 · 账号与家庭管理</option>
            </select>
            <button
              type="submit"
              disabled={rolePending}
              className="min-h-11 shrink-0 rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium transition-colors hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rolePending ? "保存中…" : "保存角色"}
            </button>
          </div>
          {account.isCurrentUser && (
            <p className="text-xs leading-5 text-foreground/55">
              若把自己改为非管理员，将立即离开此管理页；家庭必须另有可用管理员。
            </p>
          )}
          <ResultMessage state={roleState} />
        </form>

        <form action={accountFormAction} className="flex flex-col gap-2 sm:items-end">
          <button
            type="submit"
            disabled={accountPending || account.isCurrentUser}
            aria-describedby={
              account.isCurrentUser ? `self-disable-help-${account.id}` : undefined
            }
            className={
              account.disabledAt
                ? "min-h-11 rounded-lg border border-emerald-700/30 px-4 py-2 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-300"
                : "min-h-11 rounded-lg border border-red-700/30 px-4 py-2 text-sm font-medium text-red-800 transition-colors hover:bg-red-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300"
            }
          >
            {accountPending
              ? account.disabledAt
                ? "恢复中…"
                : "停用中…"
              : account.disabledAt
                ? "恢复账号"
                : "停用账号"}
          </button>
          {account.isCurrentUser && (
            <p
              id={`self-disable-help-${account.id}`}
              className="text-xs text-foreground/55"
            >
              不能停用当前账号
            </p>
          )}
          <ResultMessage state={accountState} />
        </form>
      </div>
    </li>
  );
}
