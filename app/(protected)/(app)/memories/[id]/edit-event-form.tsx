"use client";

import { useActionState, useState } from "react";
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
};

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
}: {
  event: MemoryEventRow;
  people: PersonRow[];
  assets: AssetRow[];
  participantIds: string[];
  defaultWallTime: string; // datetime-local（家庭时区）
  timezone: string;
}) {
  const [state, formAction, pending] = useActionState(editEventAction, undefined);
  const [open, setOpen] = useState(false);
  const children = people.filter((p) => p.isChild);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-foreground/60 underline underline-offset-2 hover:text-foreground"
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
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state?.saved && (
        <p className="text-sm text-accent">已保存。时间轴与年龄已更新。</p>
      )}
      <input type="hidden" name="eventId" value={event.id} />

      <label className="flex flex-col gap-1 text-sm">
        标题
        <input
          name="title"
          type="text"
          required
          maxLength={100}
          defaultValue={event.title}
          className={inputClass}
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          真实发生时间（{timezone}）
          <input
            name="occurredAt"
            type="datetime-local"
            defaultValue={defaultWallTime}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          时间精度
          <select
            name="occurredAtPrecision"
            defaultValue={event.occurredAtPrecision}
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
            defaultValue={event.locationText ?? ""}
            placeholder="例如：北京 · 家里"
            className={inputClass}
          />
        </label>
      </div>

      {children.length > 0 && (
        <label className="flex flex-col gap-1 text-sm">
          孩子档案（时间轴年龄按此孩子的生日计算）
          <select
            name="childPersonId"
            defaultValue={event.childPersonId}
            className={inputClass}
          >
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
                defaultChecked={participantIds.includes(p.id)}
                className="h-4 w-4"
              />
              {p.displayName}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        封面素材
        <select
          name="coverAssetId"
          defaultValue={event.coverAssetId ?? ""}
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
        修改这里只改变「这件事」的时间与内容；照片自身的拍摄时间在收件箱/素材层单独管理。
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
