import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { StatusBadge } from "@/components/status-badge";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { requireFamily } from "@/lib/family/context";
import { getTimelineFacets } from "@/lib/memories/service";
import { listStories } from "@/lib/stories/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "书籍与备份 · Family Time Capsule" };

const STORY_KIND: Record<string, string> = {
  weekly: "周记",
  monthly: "月章",
  yearly: "年章",
};

export default async function BooksPage() {
  const context = await requireFamily();
  const canExport = hasFamilyCapability(context.role, "archive:export");
  const canBackup = hasFamilyCapability(context.role, "backup:manage");
  const [facets, stories] = await Promise.all([
    getTimelineFacets(context.familyId),
    listStories(context.familyId),
  ]);
  const publishedStories = stories.filter((story) => story.status === "published");

  return (
    <main className="page-container max-w-5xl">
      <PageHeader
        eyebrow="Keep & share"
        title="书籍与备份"
        description="故事和年度回顾可以做成离线阅读的 PDF 或 EPUB；完整家庭备份则用于迁移与灾难恢复，两者各有用途。"
      />

      <section className="mt-10" aria-label="年度回顾成书">
        <SectionHeader
          title="年度回顾"
          description="按真实发生时间收录这一年的记忆与图片"
          actionHref="/timeline"
          actionLabel="查看时间轴"
        />
        {facets.years.length > 0 ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {facets.years.map((year) => (
              <article key={year} className="rounded-2xl border border-line bg-surface p-5">
                <p className="page-eyebrow">Family yearbook</p>
                <h2 className="mt-2 text-2xl font-semibold">{year} 家庭年册</h2>
                <p className="mt-2 text-sm text-muted">时间轴中的这一年，按日期排成一册。</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <a href={`/api/books/year/${year}?format=pdf`} className="ui-button-primary">下载 PDF</a>
                  <a href={`/api/books/year/${year}?format=epub`} className="ui-button-secondary">下载 EPUB</a>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-3">
            <EmptyState
              icon="book"
              title="还没有可以成书的年份"
              description="确认第一段记忆后，它会按发生年份加入年度回顾。"
              action="记录第一段记忆"
              actionHref="/capture"
            />
          </div>
        )}
      </section>

      <section className="mt-10" aria-label="故事成书">
        <SectionHeader
          title="家庭故事"
          description="已发布的故事可以原样带到打印店或电子阅读器"
          actionHref="/stories"
          actionLabel="查看全部故事"
        />
        {publishedStories.length > 0 ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {publishedStories.map((story) => (
              <Link key={story.id} href={`/stories/${story.id}`} className="rounded-2xl border border-line bg-surface p-5 hover:border-accent/50">
                <StatusBadge tone="success">已发布 · {STORY_KIND[story.kind] ?? "故事"}</StatusBadge>
                <h2 className="mt-3 text-lg font-semibold">{story.title}</h2>
                <p className="mt-2 text-sm text-muted">打开阅读，并选择 PDF 或 EPUB</p>
                <span className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-accent">阅读与下载</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-line p-4 text-sm text-muted">
            故事发布后会出现在这里；草稿仍可在故事页继续编辑。
          </p>
        )}
      </section>

      {canExport ? (
        <section className="mt-10 rounded-2xl border border-line bg-surface p-5 sm:p-6" aria-label="完整家庭备份">
          <SectionHeader title="完整家庭备份" description="用于迁移和灾难恢复，包含原件与可验证的档案数据" />
          <div className="mt-4 flex flex-wrap gap-3">
            <a href="/api/export" className="ui-button-primary">导出完整备份 ZIP</a>
            {canBackup ? <Link href="/settings/backup" className="ui-button-secondary">管理远程备份</Link> : null}
          </div>
          <details className="mt-4 text-sm text-muted">
            <summary className="min-h-11 py-3 font-medium">备份里有什么？</summary>
            <p className="leading-6">导出会重新核对每份原件的 SHA-256，并包含记忆、家人讲述、故事、胶囊与恢复所需关系。书籍适合阅读，完整备份适合保全；请分别保存。</p>
          </details>
        </section>
      ) : null}
    </main>
  );
}
