"use client";

import { useActionState } from "react";
import {
  createReadGrantAction,
  revokeReadGrantAction,
  type ReadGrantFormState,
} from "./read-grant-actions";
import type { ReadGrantDto } from "@/lib/family/read-grants";

const inputClass =
  "min-h-11 rounded-lg border border-foreground/20 bg-background px-3 py-2 text-base outline-none transition-colors focus-visible:border-accent";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

function CreateForm({ collectionId }: { collectionId: string }) {
  const [state, formAction, pending] = useActionState(
    createReadGrantAction,
    undefined,
  );
  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="collectionId" value={collectionId} />
        <label className="flex flex-col gap-1 text-sm">
          有效期
          <select name="days" defaultValue="30" className={inputClass}>
            <option value="7">7 天</option>
            <option value="30">30 天</option>
            <option value="90">90 天</option>
            <option value="0">长期有效（直到收回）</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-lg bg-foreground px-4 py-2 text-sm text-background transition-opacity disabled:opacity-50"
        >
          {pending ? "生成中…" : "生成只读链接"}
        </button>
      </form>
      {state?.error ? (
        <p role="alert" className="text-sm leading-6 text-red-700 dark:text-red-300">
          {state.error}
        </p>
      ) : null}
      {state?.invitePath ? (
        <div className="rounded-xl border border-amber-700/30 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            只读链接已生成（只显示这一次，请立即复制给家人）：
          </p>
          <code className="mt-2 block break-all rounded-lg border border-amber-700/20 bg-background/60 p-2 text-xs">
            {state.invitePath}
          </code>
        </div>
      ) : null}
    </div>
  );
}

function RevokeButton({
  grantId,
  collectionId,
}: {
  grantId: string;
  collectionId: string;
}) {
  const [state, formAction, pending] = useActionState(
    revokeReadGrantAction,
    undefined,
  );
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="grantId" value={grantId} />
      <input type="hidden" name="collectionId" value={collectionId} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-lg border border-red-700/30 px-3 py-1.5 text-xs font-medium text-red-800 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-300"
      >
        {pending ? "收回中…" : state?.revoked ? "已收回" : "收回链接"}
      </button>
    </form>
  );
}

/** 相册的访客只读链接管理（ID-5；管理员）。 */
export function ReadGrantPanel({
  collectionId,
  grants,
}: {
  collectionId: string;
  grants: ReadGrantDto[];
}) {
  return (
    <section
      aria-label="访客阅读链接"
      className="mt-8 rounded-2xl border border-line bg-surface p-5"
    >
      <h2 className="text-lg font-medium">访客阅读链接</h2>
      <p className="mt-1 text-sm leading-6 text-foreground/60">
        给没有账号的长辈一个「只能看这一本相册」的链接：不能投稿、不能浏览家庭的其他内容，
        可随时收回。链接只显示一次，服务端只保存其哈希。
      </p>
      <div className="mt-4">
        <CreateForm collectionId={collectionId} />
      </div>
      {grants.length > 0 ? (
        <ul className="mt-5 flex flex-col gap-2">
          {grants.map((grant) => (
            <li
              key={grant.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-foreground/10 bg-foreground/[0.02] px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <span className="font-medium">{grant.collectionTitle}</span>
                <span className="ml-2 text-foreground/55">
                  创建于 {dateFormatter.format(grant.createdAt)}
                  {grant.expiresAt ? ` · 到期 ${dateFormatter.format(grant.expiresAt)}` : " · 长期有效"}
                  {` · 被浏览 ${grant.viewCount} 次`}
                  {grant.lastViewedAt ? ` · 最近 ${dateFormatter.format(grant.lastViewedAt)}` : ""}
                </span>
                {grant.revokedAt ? (
                  <span className="ml-2 rounded-full border border-red-700/25 bg-red-500/10 px-2 py-0.5 text-xs text-red-800 dark:text-red-300">
                    已收回
                  </span>
                ) : null}
              </div>
              {!grant.revokedAt ? (
                <RevokeButton grantId={grant.id} collectionId={collectionId} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
