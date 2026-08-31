"use client";

import { useActionState } from "react";
import { addContentAction, openAction, sealAction } from "../actions";

const inputClass =
  "min-h-11 rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export type CapsuleEventOption = { id: string; title: string };
export type CapsuleContributionOption = { id: string; label: string };

export function CapsuleActions({
  capsuleId,
  status,
  unlocked,
  eventOptions,
  contributionOptions,
}: {
  capsuleId: string;
  status: string;
  unlocked: boolean;
  eventOptions: CapsuleEventOption[];
  contributionOptions: CapsuleContributionOption[];
}) {
  const [addState, addAction, addPending] = useActionState(addContentAction, undefined);
  const [sealState, sealRun, sealPending] = useActionState(sealAction, undefined);
  const [openState, openRun, openPending] = useActionState(openAction, undefined);

  return (
    <div className="mt-8 flex flex-col gap-6">
      {status === "draft" && (
        <section
          aria-label="添加内容"
          className="rounded-xl border border-foreground/10 p-4"
        >
          <h2 className="text-sm font-medium">往胶囊里放东西</h2>
          <form action={addAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="capsuleId" value={capsuleId} />
            <input type="hidden" name="kind" value="event" />
            <label className="flex flex-col gap-1 text-sm">
              记忆事件
              <select name="id" required defaultValue="" className={`${inputClass} min-w-56`}>
                <option value="" disabled>
                  选择记忆事件
                </option>
                {eventOptions.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={addPending}
              className="min-h-11 rounded-lg border border-foreground/20 px-3 py-2 text-sm transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
            >
              {addPending ? "添加中…" : "添加"}
            </button>
          </form>
          {contributionOptions.length > 0 ? (
            <form
              action={addAction}
              className="mt-4 flex flex-wrap items-end gap-2 border-t border-foreground/10 pt-4"
            >
              <input type="hidden" name="capsuleId" value={capsuleId} />
              <input type="hidden" name="kind" value="contribution" />
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                家人讲述
                <select
                  name="id"
                  required
                  defaultValue=""
                  className={`${inputClass} w-full`}
                >
                  <option value="" disabled>
                    选择当前可见的讲述
                  </option>
                  {contributionOptions.map((contribution) => (
                    <option key={contribution.id} value={contribution.id}>
                      {contribution.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={addPending}
                className="min-h-11 rounded-lg border border-foreground/20 px-3 py-2 text-sm transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
              >
                {addPending ? "添加中…" : "添加讲述"}
              </button>
            </form>
          ) : (
            <p className="mt-4 border-t border-foreground/10 pt-4 text-sm text-foreground/50">
              暂无可加入的家人讲述。
            </p>
          )}
          {addState?.error && (
            <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
              {addState.error}
            </p>
          )}
        </section>
      )}

      {status === "draft" && (
        <form
          action={sealRun}
          className="rounded-xl border border-accent/30 bg-accent/[0.03] p-4"
        >
          <input type="hidden" name="capsuleId" value={capsuleId} />
          <p className="text-sm leading-6 text-foreground/70">
            封存后，内容在开启条件到达前不会在页面上显示。你仍然可以随时完整导出备份。
          </p>
          <button
            type="submit"
            disabled={sealPending}
            className="mt-3 rounded-lg bg-foreground px-4 py-2 text-sm text-background transition-opacity disabled:opacity-50"
          >
            {sealPending ? "封存中…" : "封存胶囊"}
          </button>
          {sealState?.error && (
            <span className="ml-3 text-xs text-red-700 dark:text-red-400">
              {sealState.error}
            </span>
          )}
        </form>
      )}

      {status === "sealed" && (
        <form action={openRun} className="rounded-xl border border-foreground/10 p-4">
          <input type="hidden" name="capsuleId" value={capsuleId} />
          <p className="text-sm leading-6 text-foreground/70">
            {unlocked
              ? "开启条件已到达，可以打开了。"
              : "还没到开启的时间。再等等——仪式感也是记忆的一部分。"}
          </p>
          <button
            type="submit"
            disabled={openPending || !unlocked}
            className="mt-3 rounded-lg border border-foreground/20 px-4 py-2 text-sm transition-colors hover:border-accent disabled:opacity-40"
          >
            {openPending ? "开启中…" : "开启胶囊"}
          </button>
          {openState?.error && (
            <span className="ml-3 text-xs text-red-700 dark:text-red-400">
              {openState.error}
            </span>
          )}
        </form>
      )}
    </div>
  );
}
