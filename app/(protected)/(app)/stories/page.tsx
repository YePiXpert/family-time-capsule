import type { Metadata } from "next";
import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { listStories } from "@/lib/stories/service";
import { StoryCreateForms } from "./story-ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "故事 · Family Time Capsule" };

const KIND_LABEL: Record<string, string> = {
  weekly: "周记",
  monthly: "月章",
  yearly: "年章",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  edited: "已编辑",
  published: "已发布",
};

export default async function StoriesPage() {
  const context = await requireFamily();
  const canWrite = hasFamilyCapability(context.role, "story:write");
  const canAi = hasFamilyCapability(context.role, "ai:review");
  const stories = await listStories(context.familyId);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold">故事</h1>
      <p className="mt-2 text-sm leading-6 text-foreground/60">
        周记 / 月章 / 年章由已确认的事实与家人讲述组成；每一段都可追溯到来源，
        引文逐字来自原始讲述。AI 只起草，家人编辑后发布。
      </p>

      {canWrite && <StoryCreateForms canAi={canAi} />}

      {stories.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-foreground/20 p-8 text-center text-sm text-foreground/50">
          还没有故事。选一个时间段，从已确认的内容开始组装第一篇草稿。
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-3" aria-label="故事列表">
          {stories.map((s) => (
            <li key={s.id} className="rounded-xl border border-foreground/10 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/stories/${s.id}`}
                  className="text-sm font-medium hover:text-accent"
                >
                  {s.title}
                </Link>
                <span className="flex items-center gap-2 text-xs text-foreground/50">
                  <span className="rounded border border-foreground/15 px-1.5 py-0.5">
                    {KIND_LABEL[s.kind] ?? s.kind}
                  </span>
                  <span
                    className={
                      s.status === "published"
                        ? "rounded border border-emerald-700/40 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400"
                        : "rounded border border-foreground/15 px-1.5 py-0.5"
                    }
                  >
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                  <span>{s.paragraphCount} 段</span>
                </span>
              </div>
              <p className="mt-1 text-xs text-foreground/45">
                {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(s.periodStart)}
                {" ~ "}
                {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(s.periodEnd)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
