"use client";
import { MediaReader } from "@/components/media-reader";

import { useActionState } from "react";
import type { PersonRow } from "@/lib/memories/service";
import type { VisibleContributionDto } from "@/lib/authz/contribution-access";
import {
  addContributionAction,
  editContributionAction,
} from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

const VISIBILITY_LABEL: Record<string, string> = {
  private: "仅自己",
  parents: "父母可见",
  family: "家人可见",
  child_later: "留给孩子将来",
};

/** 新增视角表单：作者可选任何家庭成员（不要求有账号） */
export function AddContributionForm({
  memoryEventId,
  people,
}: {
  memoryEventId: string;
  people: PersonRow[];
}) {
  const [state, formAction, pending] = useActionState(addContributionAction, undefined);
  const authors = people.filter((p) => !p.isChild);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      {state?.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
      <input type="hidden" name="memoryEventId" value={memoryEventId} />
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          谁在讲述
          <select name="authorPersonId" required className={inputClass} defaultValue="">
            <option value="" disabled>
              选择家人
            </option>
            {authors.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
                {p.relationToChild && p.relationToChild !== p.displayName
                  ? `（${p.relationToChild}）`
                  : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          可见范围
          <select name="visibility" defaultValue="family" className={inputClass}>
            {Object.entries(VISIBILITY_LABEL).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <textarea
        name="text"
        required
        maxLength={5000}
        rows={3}
        placeholder="TA 想说的那段话……"
        className={inputClass}
      />
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg border border-foreground/20 px-4 py-2 text-sm transition-colors hover:border-accent disabled:opacity-50"
      >
        {pending ? "保存中…" : "保存这段讲述"}
      </button>
    </form>
  );
}

/** 单条视角：显示 + 行内编辑（只影响这一行） */
export function ContributionBlock({
  dateLabel,
  contribution,
  canEdit,
}: {
  contribution: VisibleContributionDto;
  dateLabel?: string;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(editContributionAction, undefined);
  const text = contribution.editedText ?? contribution.rawText ?? "";

  return (
    <article className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">
          {contribution.authorName}
          {contribution.authorRelation ? (
            <span className="ml-2 text-sm font-normal text-foreground/55">
              {contribution.authorRelation}
            </span>
          ) : null}
        </h3>
        <span className="text-xs text-foreground/45">
          {VISIBILITY_LABEL[contribution.visibility] ?? contribution.visibility}
        </span>
      </header>
      {contribution.editedText && contribution.rawText && contribution.editedText !== contribution.rawText && (
        <p className="mt-2 whitespace-pre-wrap border-l-2 border-foreground/10 pl-3 text-sm text-foreground/50">
          原稿：{contribution.rawText}
        </p>
      )}
      <p className="mt-2 whitespace-pre-wrap leading-7">{text}</p>
      {contribution.audioAssetId ? <MediaReader assets={[{id:contribution.audioAssetId,type:"audio",filename:"家人的声音",mimeType:"audio/mp4",author:contribution.authorName,dateLabel}]} />:null}
      {canEdit && <form action={formAction} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="contributionId" value={contribution.id} />
        <input
          type="hidden"
          name="memoryEventId"
          value={contribution.memoryEventId}
        />
        <textarea
          name="editedText"
          defaultValue={text}
          required
          maxLength={5000}
          rows={2}
          className={inputClass}
          aria-label={`编辑 ${contribution.authorName} 的讲述`}
        />
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-lg border border-foreground/15 px-3 py-1.5 text-xs transition-colors hover:border-accent disabled:opacity-50"
        >
          {pending ? "保存中…" : "修改这段讲述"}
        </button>
        {state?.error && (
          <span className="text-xs text-red-700 dark:text-red-400">{state.error}</span>
        )}
      </form>}
    </article>
  );
}
