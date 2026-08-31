"use client";

import { useActionState } from "react";
import {
  manuallyUnlockChildAction,
  setGuardianAction,
  setUnlockAgeAction,
  type FamilyPolicyFormState,
} from "./actions";

function Result({ state }: { state: FamilyPolicyFormState | undefined }) {
  if (!state?.error && !state?.success) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      className={
        state.error
          ? "text-xs leading-5 text-red-700 dark:text-red-300"
          : "text-xs leading-5 text-emerald-700 dark:text-emerald-300"
      }
    >
      {state.error ?? state.success}
    </p>
  );
}

export function GuardianControl({
  personId,
  isGuardian,
}: {
  personId: string;
  isGuardian: boolean;
}) {
  const action = setGuardianAction.bind(null, personId, !isGuardian);
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1 sm:items-end">
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-lg border border-foreground/20 px-3 py-2 text-sm font-medium transition-colors hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending
          ? "保存中…"
          : isGuardian
            ? "移除监护人权限"
            : "设为监护人"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function UnlockAgeForm({ currentAge }: { currentAge: number }) {
  const [state, formAction, pending] = useActionState(
    setUnlockAgeAction,
    undefined,
  );
  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <label className="flex max-w-xs flex-col gap-1.5 text-sm font-medium">
        自动解锁年龄
        <span className="font-normal leading-5 text-foreground/60">
          到达此周岁后，“长大后可见”内容会按家庭时区自动开放。
        </span>
        <input
          name="unlockAge"
          type="number"
          min={1}
          max={100}
          step={1}
          required
          defaultValue={currentAge}
          className="min-h-11 rounded-lg border border-foreground/20 bg-background px-3 py-2 text-base outline-none focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 self-start rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium transition-colors hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "保存中…" : "保存解锁年龄"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function ChildUnlockControl({
  childPersonId,
  alreadyUnlocked,
}: {
  childPersonId: string;
  alreadyUnlocked: boolean;
}) {
  const action = manuallyUnlockChildAction.bind(null, childPersonId);
  const [state, formAction, pending] = useActionState(action, undefined);
  if (alreadyUnlocked) {
    return (
      <p className="text-xs leading-5 text-emerald-700 dark:text-emerald-300">
        已永久手工解锁
      </p>
    );
  }
  return (
    <form
      action={formAction}
      className="mt-3 rounded-xl border border-amber-700/25 bg-amber-500/5 p-3"
    >
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-xs leading-5">
        <input
          type="checkbox"
          name="confirmIrreversible"
          value="yes"
          required
          className="mt-1 size-4 shrink-0 accent-accent"
        />
        <span>
          我确认：现在解锁会让这名孩子的“长大后可见”内容立即开放，而且不能重新锁定。
        </span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="mt-2 min-h-11 rounded-lg border border-amber-800/40 px-3 py-2 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-200"
      >
        {pending ? "解锁中…" : "永久手工解锁"}
      </button>
      <div className="mt-1">
        <Result state={state} />
      </div>
    </form>
  );
}
