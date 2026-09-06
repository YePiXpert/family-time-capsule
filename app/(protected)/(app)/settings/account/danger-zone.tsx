"use client";

import { useActionState } from "react";
import {
  confirmExportStepUpAction,
  deleteAccountAction,
  leaveFamilyAction,
} from "./actions";

const inputClass =
  "min-h-11 rounded-lg border border-foreground/20 bg-background px-3 py-2 text-base outline-none transition-colors focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60";

/**
 * 高敏自助操作（M2-c）：
 * - 完整导出需要 10 分钟内的密码复核（ID-10 step-up），确认后浏览器下载；
 * - 退出家庭（ID-13）与删除账号（ID-14，需密码+明确确认语）。
 */
export function ExportStepUpPanel({ needsStepUp }: { needsStepUp: boolean }) {
  const [state, formAction, pending] = useActionState(
    confirmExportStepUpAction,
    undefined,
  );
  if (!needsStepUp || state?.exportReady) {
    return (
      <div className="flex flex-col gap-2">
        <a
          href="/api/export"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-foreground px-4 py-2.5 text-sm text-background transition-opacity hover:opacity-90"
        >
          导出完整备份 ZIP
        </a>
        <p className="text-xs text-foreground/55">
          {state?.exportReady ? "密码复核已通过（10 分钟内有效）。" : "密码复核在近期已完成。"}
        </p>
      </div>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <p className="text-sm leading-6 text-foreground/70">
        完整导出是高敏操作，请先确认当前密码（复核 10 分钟内有效）。
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="password"
          name="currentPassword"
          required
          autoComplete="current-password"
          placeholder="当前密码"
          disabled={pending}
          className={`${inputClass} min-w-0 flex-1`}
        />
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 shrink-0 rounded-lg bg-foreground px-4 py-2 text-sm text-background transition-opacity disabled:opacity-50"
        >
          {pending ? "复核中…" : "确认密码并导出"}
        </button>
      </div>
      {state?.error ? (
        <p role="alert" className="text-sm leading-6 text-red-700 dark:text-red-300">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function DangerZone({ isOwner }: { isOwner: boolean }) {
  const [leaveState, leaveFormAction, leavePending] = useActionState(
    leaveFamilyAction,
    undefined,
  );
  const [deleteState, deleteFormAction, deletePending] = useActionState(
    deleteAccountAction,
    undefined,
  );
  return (
    <section
      aria-label="账号与家庭变更"
      className="mt-10 rounded-2xl border border-red-800/20 bg-red-500/[0.03] p-5 sm:p-6"
    >
      <h2 className="text-lg font-medium">退出与删除</h2>
      <p className="mt-1 text-sm leading-6 text-foreground/60">
        退出家庭只解除登录与绑定，你的讲述与人物记录保留在家庭档案中；删除账号会撤销全部登录凭据并匿名化账号身份，
        不可恢复。已下载到家人设备的副本不受影响（权限缩小≠远程抹除）。
      </p>

      <form action={leaveFormAction} className="mt-4 flex flex-col gap-2">
        <button
          type="submit"
          disabled={leavePending || isOwner}
          className="min-h-11 w-fit rounded-lg border border-foreground/20 px-4 py-2 text-sm transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {leavePending ? "退出中…" : "离开这个家庭"}
        </button>
        {isOwner ? (
          <p className="text-xs text-foreground/55">
            所有者需先在「管理现有账号」中移交所有权，才能退出家庭。
          </p>
        ) : null}
        {leaveState?.error ? (
          <p role="alert" className="text-sm leading-6 text-red-700 dark:text-red-300">
            {leaveState.error}
          </p>
        ) : null}
      </form>

      <form action={deleteFormAction} className="mt-6 flex flex-col gap-3 border-t border-red-800/15 pt-5">
        <p className="text-sm font-medium">删除我的账号</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="password"
            name="currentPassword"
            required
            autoComplete="current-password"
            placeholder="当前密码"
            disabled={deletePending}
            className={`${inputClass} min-w-0 flex-1`}
          />
          <input
            type="text"
            name="confirmation"
            required
            pattern="删除我的账号"
            placeholder="输入「删除我的账号」"
            disabled={deletePending}
            className={`${inputClass} min-w-0 flex-1`}
          />
          <button
            type="submit"
            disabled={deletePending}
            className="min-h-11 shrink-0 rounded-lg border border-red-700/30 px-4 py-2 text-sm font-medium text-red-800 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300"
          >
            {deletePending ? "删除中…" : "永久删除账号"}
          </button>
        </div>
        {deleteState?.error ? (
          <p role="alert" className="text-sm leading-6 text-red-700 dark:text-red-300">
            {deleteState.error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
