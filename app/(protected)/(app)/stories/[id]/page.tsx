import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFamily } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { getStory } from "@/lib/stories/service";
import {
  AddParagraphForm,
  ParagraphEditor,
  PublishForm,
  RegenerateButton,
  TitleEditForm,
} from "../story-ui";
import { EmptyState } from "@/components/empty-state";
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

const SOURCE_TYPE_LABEL: Record<string, string> = {
  fact: "已确认事实",
  contribution: "家人讲述",
  transcript: "录音文字",
  user_text: "家人补写",
};

export default async function StoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  const context = await requireFamily();
  const { id } = await params;
  const detail = await getStory(context.familyId, id);
  if (!detail) notFound();

  const canWrite = hasFamilyCapability(context.role, "story:write");
  const { story: storyRow, paragraphs } = detail;
  const editable = storyRow.status !== "published";
  const query = await searchParams;
  const editMode = canWrite && editable && query.mode === "edit";
  const dateRange = `${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(storyRow.periodStart)} — ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(storyRow.periodEnd)}`;

  return (
    <main className="page-container max-w-4xl">
      <PageHeader
        backHref="/stories"
        backLabel="返回故事"
        eyebrow={editMode ? "编辑故事" : KIND_LABEL[storyRow.kind] ?? "家庭故事"}
        title={storyRow.title}
        description={dateRange}
        actions={canWrite && editable ? (
          <Link
            href={editMode ? `/stories/${storyRow.id}` : `/stories/${storyRow.id}?mode=edit`}
            className={editMode ? "ui-button-secondary" : "ui-button-primary"}
          >
            {editMode ? "返回阅读" : "编辑故事"}
          </Link>
        ) : undefined}
      />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <StatusBadge tone="accent">{KIND_LABEL[storyRow.kind] ?? storyRow.kind}</StatusBadge>
        <StatusBadge tone={storyRow.status === "published" ? "success" : "neutral"}>
          {STATUS_LABEL[storyRow.status] ?? storyRow.status}
        </StatusBadge>
        <span className="text-xs text-muted">{paragraphs.length} 段</span>
      </div>

      {editMode ? (
        <section className="mt-6 rounded-2xl border border-accent/35 bg-accent-soft/40 p-4 sm:p-5" aria-label="编辑故事">
          <h2 className="font-semibold">编辑故事</h2>
          <TitleEditForm storyId={storyRow.id} title={storyRow.title} />
          <div className="mt-3">
            <RegenerateButton
              kind={storyRow.kind}
              anchor={storyRow.periodStart.toISOString().slice(0, 10)}
            />
          </div>
        </section>
      ) : null}

      <article className="mt-8 rounded-2xl border border-line bg-surface px-5 py-8 shadow-[0_12px_40px_rgba(70,55,38,0.06)] sm:px-10 sm:py-12" aria-label="故事正文">
        <header className="mx-auto max-w-2xl border-b border-line pb-7 text-center">
          <p className="page-eyebrow">{KIND_LABEL[storyRow.kind] ?? "家庭故事"}</p>
          <h2 className="mt-3 text-2xl font-semibold leading-tight sm:text-3xl">{storyRow.title}</h2>
          <p className="mt-3 text-sm text-muted">{dateRange}</p>
        </header>
        <div className="mx-auto mt-8 flex max-w-2xl flex-col gap-7">
        {paragraphs.map((p) => (
          <article
            key={p.id}
            className={editMode ? "rounded-xl border border-line bg-background/50 p-4" : ""}
          >
            {p.kind === "quote" ? (
              <blockquote className="border-l-2 border-accent/50 pl-4 text-lg leading-8 text-foreground/90">
                {p.text}
              </blockquote>
            ) : (
              <p className="whitespace-pre-wrap text-base leading-8 text-foreground/90 sm:text-lg">
                {p.text}
              </p>
            )}
            {p.sources.length > 0 ? (
              <p className="mt-2 text-xs text-muted">
                来自 {p.sources.map((s) => SOURCE_TYPE_LABEL[s.sourceType] ?? "家庭档案").join(" · ")}
              </p>
            ) : null}
            {editMode && (
              <ParagraphEditor
                storyId={storyRow.id}
                paragraphId={p.id}
                kind={p.kind}
                text={p.text}
              />
            )}
          </article>
        ))}
        {paragraphs.length === 0 && (
          <EmptyState
            icon="story"
            title="这个故事还没有正文"
            description="可以进入编辑补写一段，或重新从已确认的家庭内容组装。"
            action={canWrite ? "编辑故事" : "返回故事列表"}
            actionHref={canWrite ? `/stories/${storyRow.id}?mode=edit` : "/stories"}
          />
        )}
        </div>
      </article>

      {editMode ? <AddParagraphForm storyId={storyRow.id} /> : null}
      {editMode && (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
          <p className="mb-3 text-sm text-muted">确认文字与引文无误后发布；发布版本保持不变，之后重组会另建草稿。</p>
          <PublishForm storyId={storyRow.id} />
        </div>
      )}
      {storyRow.status === "published" && (
        <section className="mt-8 rounded-2xl border border-line bg-surface p-5" aria-label="把故事做成书">
          <h2 className="text-lg font-semibold">把这篇故事带走</h2>
          <p className="mt-1 text-sm text-muted">
            已发布 · {storyRow.publishedAt ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(storyRow.publishedAt) : ""}
            。下载后不需要连接家庭服务器，也能阅读文字与内嵌图片。
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <a
              href={`/api/books/story/${storyRow.id}?format=pdf`}
              className="ui-button-primary"
            >
              下载适合打印的 PDF
            </a>
            <a
              href={`/api/books/story/${storyRow.id}?format=epub`}
              className="ui-button-secondary"
            >
              下载阅读器 EPUB
            </a>
          </div>
        </section>
      )}
    </main>
  );
}
