"use client";

import { useActionState, useRef, useState } from "react";
import type { PersonRow } from "@/lib/memories/service";
import type { AssetRow } from "@/lib/assets/service";
import type { MemoryEventRow } from "@/lib/memories/service";
import { editEventAction } from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

const PRECISION_LABEL: Record<string, string> = {
  exact: "精确到分",
  approximate: "大致时间",
  date_only: "只记得日期",
  month: "只记得年月",
  year: "只记得年份",
  unknown: "时间记不得了",
};

const MILESTONE_OPTIONS = [
  { value: "", label: "普通记忆（不标记节点）", prompt: "" },
  { value: "first_time", label: "第一次", prompt: "第一次做到了一件什么事？" },
  { value: "growth", label: "成长", prompt: "最近发现了怎样的变化？" },
  { value: "learning", label: "学会了", prompt: "学会了什么新本领？" },
  { value: "family", label: "家庭时刻", prompt: "一家人共同经历了什么？" },
  { value: "celebration", label: "庆祝", prompt: "今天在庆祝什么？" },
  { value: "other", label: "值得记住", prompt: "为什么想把这一刻特别留下？" },
] as const;

/**
 * 事件编辑（RH-003）：标题 / 时间 / 精度 / 地点 / 封面 / 参与人 / 孩子档案。
 * 修改保存后：时间轴按新 occurredAt 重排，年龄按 birthDate 现算；
 * 素材的 capturedAt / importedAt 不受影响。
 */
export function EditEventForm({
  event,
  people,
  assets,
  participantIds,
  defaultWallTime,
  timezone,
  initiallyOpen = false,
}: {
  event: MemoryEventRow;
  people: PersonRow[];
  assets: AssetRow[];
  participantIds: string[];
  defaultWallTime: string; // datetime-local（家庭时区）
  timezone: string;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [revision, setRevision] = useState(event.titleRevision);
  const initialValues = () => ({ title: event.title, bodyText: event.bodyText, precision: event.occurredAtPrecision,
    wall: event.occurredAtPrecision === "unknown" ? "" : event.occurredAtPrecision === "year" ? defaultWallTime.slice(0, 4)
      : event.occurredAtPrecision === "month" ? defaultWallTime.slice(0, 7) : event.occurredAtPrecision === "date_only" ? defaultWallTime.slice(0, 10) : defaultWallTime,
    location: event.locationText ?? "", child: event.childPersonId ?? "", participants: participantIds,
    milestone: event.milestoneType ?? "", pinned: event.isPinned, cover: event.coverAssetId ?? "" });
  const [values, setValues] = useState(initialValues);
  const mutation = useRef<{ signature: string; id: string } | null>(null);
  const [state, formAction, pending] = useActionState(async (_previous: { error?: string; saved?: boolean } | undefined, data: FormData) => {
    const signature = JSON.stringify([...data.entries()]);
    if (mutation.current?.signature !== signature) mutation.current = { signature, id: crypto.randomUUID() };
    data.set("mutationId", mutation.current.id);
    try {
      const result = await editEventAction(undefined, data);
      if (result.saved && result.revision !== undefined) setRevision(result.revision);
      return result;
    } catch {
      return { error: "暂时无法保存，输入已保留。请联网后重试。" };
    }
  }, undefined);
  const children = people;
  const set = <K extends keyof typeof values>(key: K, value: typeof values[K]) => setValues(previous => ({ ...previous, [key]: value }));

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setRevision(event.titleRevision); setValues(initialValues()); setOpen(true); }}
        className="ui-button-secondary"
      >
        修改这件事
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="mt-4 flex flex-col gap-4 rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4"
      aria-label="编辑事件"
    >
      {state?.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state?.saved && (
        <p className="text-sm text-accent">已保存。时间轴与年龄已更新。</p>
      )}
      <input type="hidden" name="eventId" value={event.id} />
      <input type="hidden" name="expectedRevision" value={revision} />

      <label className="flex flex-col gap-1 text-sm">
        标题
        <input
          name="title"
          type="text"
          required
          maxLength={100}
          value={values.title}
          onChange={e => set("title", e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        记忆正文
        <textarea name="bodyText" maxLength={100000} rows={5} value={values.bodyText} onChange={e => set("bodyText", e.target.value)} className={inputClass} />
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          真实发生时间（{timezone}；按所选精度填写）
          <input
            name="occurredAt"
            type={values.precision === "month" ? "month" : values.precision === "year" || values.precision === "unknown" ? "text" : values.precision === "date_only" ? "date" : "datetime-local"}
            value={values.wall}
            disabled={values.precision === "unknown"}
            required={values.precision !== "unknown"}
            pattern={values.precision === "year" ? "[0-9]{4}" : undefined}
            placeholder={values.precision === "year" ? "例如 1988" : undefined}
            onChange={e => set("wall", e.target.value)}
            className={inputClass}
          />
          <span className="text-xs text-ink-muted">
            选「只记得年月/年份/时间记不得了」时：这里分别填 年-月（如 1988-05）、
            年份（如 1988）或留空；系统不会编造具体日期。
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          时间精度
          <select
            name="occurredAtPrecision"
            value={values.precision}
            onChange={e => {
              const precision = e.target.value;
              setValues(previous => ({ ...previous, precision, wall: precision === "unknown" ? "" : precision === "year" ? previous.wall.slice(0, 4)
                : precision === "month" ? previous.wall.slice(0, 7) : precision === "date_only" ? previous.wall.slice(0, 10) : previous.wall }));
            }}
            className={inputClass}
          >
            {Object.entries(PRECISION_LABEL).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          地点（可选）
          <input
            name="locationText"
            type="text"
            maxLength={200}
            value={values.location}
            onChange={e => set("location", e.target.value)}
            placeholder="例如：北京 · 家里"
            className={inputClass}
          />
        </label>
      </div>

      {children.length > 0 && (
        <label className="flex flex-col gap-1 text-sm">
          年龄参考人物（可选，不改变参与人）
          <select
            name="childPersonId"
            value={values.child}
            onChange={e => set("child", e.target.value)}
            className={inputClass}
          >
            <option value="">不显示人物年龄</option>
            {children.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
                {p.birthDate ? `（生于 ${p.birthDate}）` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm">参与人</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {people.map((p) => (
            <label key={p.id} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="participantPersonIds"
                value={p.id}
                checked={values.participants.includes(p.id)}
                onChange={e => set("participants", e.target.checked ? [...values.participants, p.id] : values.participants.filter(id => id !== p.id))}
                className="h-4 w-4"
              />
              {p.displayName}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-1 text-sm font-medium">成长节点（可选）</legend>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="flex flex-col gap-1 text-sm">
            节点类型
            <select
              name="milestoneType"
              value={values.milestone}
              onChange={e => set("milestone", e.target.value)}
              className={inputClass}
            >
              {MILESTONE_OPTIONS.map((option) => (
                <option key={option.value || "none"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isPinned"
              checked={values.pinned}
              onChange={e => set("pinned", e.target.checked)}
              className="h-4 w-4"
            />
            在节点中置顶
          </label>
        </div>
        <details className="mt-2 text-xs leading-5 text-muted">
          <summary className="min-h-11 cursor-pointer py-3 font-medium">看看可选记录提示</summary>
          <ul className="space-y-1 pb-1">
            {MILESTONE_OPTIONS.slice(1).map((option) => (
              <li key={option.value}>· {option.label}：{option.prompt}</li>
            ))}
          </ul>
        </details>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        封面素材
        <select
          name="coverAssetId"
          value={values.cover}
          onChange={e => set("cover", e.target.value)}
          className={inputClass}
        >
          <option value="">（自动：第一张照片）</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.type === "image" ? "照片" : a.type} · {a.originalFilename}
            </option>
          ))}
        </select>
      </label>

      <p className="text-xs leading-5 text-foreground/45">
        节点只是这段 MemoryEvent 的展示标记，不会建立另一套记录；修改事件也不会改变照片自身的拍摄或导入时间。
      </p>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-foreground px-4 py-2 text-sm text-background transition-opacity disabled:opacity-50"
        >
          {pending ? "保存中…" : "保存修改"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-foreground/15 px-4 py-2 text-sm"
        >
          收起
        </button>
      </div>
    </form>
  );
}
