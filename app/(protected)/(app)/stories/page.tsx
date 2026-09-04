import type { Metadata } from "next";
import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { listStories } from "@/lib/stories/service";
import { StoryCreateForms } from "./story-ui";
import { EmptyState } from "@/components/empty-state";
import { MediaImage } from "@/components/media-view";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";

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
    <main className="page-container max-w-6xl">
      <PageHeader
        eyebrow="Family stories"
        title="家庭故事"
        description="把分散在时间轴里的事实、声音和家人视角，编成适合坐下来阅读的一章。没有 AI 也能从已确认内容组装草稿。"
      />

      {canWrite && <StoryCreateForms canAi={canAi} />}

      {stories.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            icon="story"
            title="还没有家庭故事"
            description="先从一周、一个月或一年开始，把已经确认的家庭片段排成第一篇草稿。"
            action={canWrite ? "在上方组装第一篇" : "浏览已有记忆"}
            actionHref={canWrite ? "#new-story" : "/timeline"}
          />
        </div>
      ) : (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="故事列表">
          {stories.map((s) => (
            <li key={s.id} className="min-w-0">
              <Link
                href={`/stories/${s.id}`}
                className="group block h-full overflow-hidden rounded-2xl border border-line bg-surface transition-colors hover:border-accent/50"
              >
                <div className="relative aspect-[16/10] overflow-hidden bg-accent-soft">
                  {s.cover ? (
                    <MediaImage
                      assetId={s.cover.assetId}
                      mimeType={s.cover.mimeType}
                      thumbAssetId={s.cover.thumbAssetId}
                      alt=""
                      className="h-full w-full"
                      imgClassName="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-[linear-gradient(145deg,var(--accent-soft),var(--surface-muted))] px-8 text-center text-sm font-medium text-accent">
                      {KIND_LABEL[s.kind] ?? "家庭故事"}
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone="accent">{KIND_LABEL[s.kind] ?? s.kind}</StatusBadge>
                    <StatusBadge tone={s.status === "published" ? "success" : "neutral"}>
                      {STATUS_LABEL[s.status] ?? s.status}
                    </StatusBadge>
                  </div>
                  <h2 className="mt-3 line-clamp-2 text-xl font-semibold leading-7">{s.title}</h2>
                  <p className="mt-2 text-sm text-muted">
                    {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(s.periodStart)}
                    {" — "}
                    {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(s.periodEnd)}
                  </p>
                  <span className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-accent">
                    {s.status === "published" ? "开始阅读" : "阅读草稿"} · {s.paragraphCount} 段
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
