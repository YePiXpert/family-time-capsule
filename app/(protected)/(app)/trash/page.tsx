import type { Metadata } from "next";
import { requireFamily } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { listTrash } from "@/lib/trash/service";
import { TrashEntryActions } from "./trash-ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "回收站 · Family Time Capsule" };

const KIND_LABEL: Record<string, string> = {
  memory_event: "记忆事件",
  contribution: "家人讲述",
  story: "故事",
};

export default async function TrashPage() {
  const context = await requireFamily();
  const canWrite = hasFamilyCapability(context.role, "event:write");
  const entries = canWrite ? listTrash(context) : [];
  const timezone = context.familyTimezone;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold">回收站</h1>
      <p className="mt-2 text-sm leading-6 text-foreground/60">
        删除的记忆事件、讲述与故事先到这里。恢复即原样回到时间轴；「彻底清除」
        是硬删除——执行前需要勾选确认，且只影响所选内容，素材原件不会被连带删除。
      </p>

      {entries.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-foreground/20 p-8 text-center text-sm text-foreground/50">
          回收站是空的。
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-3" aria-label="回收站列表">
          {entries.map((entry) => (
            <li key={`${entry.kind}-${entry.id}`} className="rounded-xl border border-foreground/10 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{entry.label}</span>
                <span className="rounded border border-foreground/15 px-1.5 py-0.5 text-xs text-foreground/50">
                  {KIND_LABEL[entry.kind] ?? entry.kind}
                </span>
              </div>
              <p className="mt-1 text-xs text-foreground/45">
                删除于{" "}
                {new Intl.DateTimeFormat("zh-CN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: timezone,
                }).format(entry.deletedAt)}
              </p>
              <div className="mt-2">
                <TrashEntryActions kind={entry.kind} id={entry.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
