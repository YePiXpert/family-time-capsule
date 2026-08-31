"use client";

import { useActionState } from "react";
import { onboardingAction } from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-base outline-none transition-colors focus:border-accent";

const TIMEZONE_CHOICES = [
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Singapore",
  "UTC",
] as const;

const RELATION_CHOICES = ["爸爸", "妈妈", "爷爷", "奶奶", "外公", "外婆"] as const;

export function OnboardingForm({ defaultDisplayName }: { defaultDisplayName: string }) {
  const [state, formAction, pending] = useActionState(onboardingAction, undefined);

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
        家庭名称
        <input
          name="familyName"
          type="text"
          required
          maxLength={50}
          className={inputClass}
          placeholder="例如：我们一家"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        时区
        <select name="timezone" defaultValue="Asia/Shanghai" className={inputClass}>
          {TIMEZONE_CHOICES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="mt-2 flex flex-col gap-4 rounded-xl border border-foreground/10 p-4">
        <legend className="px-1 text-sm font-medium">孩子档案</legend>
        <label className="flex flex-col gap-1.5 text-sm">
          孩子姓名
          <input
            name="childDisplayName"
            type="text"
            required
            maxLength={50}
            className={inputClass}
            placeholder="例如：小满"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          出生日期（时间轴按它计算成长年龄）
          <input
            name="childBirthDate"
            type="date"
            required
            className={inputClass}
          />
        </label>
      </fieldset>
      <fieldset className="flex flex-col gap-4 rounded-xl border border-foreground/10 p-4">
        <legend className="px-1 text-sm font-medium">你自己</legend>
        <label className="flex flex-col gap-1.5 text-sm">
          显示名称
          <input
            name="selfDisplayName"
            type="text"
            required
            maxLength={50}
            defaultValue={defaultDisplayName}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          对孩子的称谓
          <input
            name="selfRelationToChild"
            type="text"
            required
            maxLength={20}
            list="relation-choices"
            className={inputClass}
            placeholder="例如：爸爸"
          />
          <datalist id="relation-choices">
            {RELATION_CHOICES.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </label>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-foreground/15 p-3 text-sm leading-6">
          <input
            name="selfIsGuardian"
            value="yes"
            type="checkbox"
            className="mt-1 size-4 shrink-0 accent-accent"
          />
          <span>
            <span className="block font-medium">我是孩子的监护人</span>
            <span className="block text-foreground/60">
              监护人可以查看“仅父母”和尚未到龄的“长大后可见”内容。此权限不会根据“爸爸”“妈妈”等称谓自动推断，默认不启用。
            </span>
          </span>
        </label>
      </fieldset>
      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-lg bg-foreground px-4 py-2.5 text-background transition-opacity disabled:opacity-50"
      >
        {pending ? "创建中…" : "创建家庭"}
      </button>
    </form>
  );
}
