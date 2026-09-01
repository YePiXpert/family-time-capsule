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
  fact: "确认事实",
  contribution: "家人讲述",
  transcript: "转录",
  user_text: "手写",
};

export default async function StoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireFamily();
  const { id } = await params;
  const detail = await getStory(context.familyId, id);
  if (!detail) notFound();

  const canWrite = hasFamilyCapability(context.role, "story:write");
  const { story: storyRow, paragraphs } = detail;
  const editable = storyRow.status !== "published";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <Link href="/stories" className="text-sm text-foreground/60 hover:text-foreground">
        ← 故事
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-foreground/50">
        <span className="rounded border border-foreground/15 px-1.5 py-0.5">
          {KIND_LABEL[storyRow.kind] ?? storyRow.kind}
        </span>
        <span className="rounded border border-foreground/15 px-1.5 py-0.5">
          {STATUS_LABEL[storyRow.status] ?? storyRow.status}
        </span>
        <span>
          {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(storyRow.periodStart)}
          {" ~ "}
          {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(storyRow.periodEnd)}
        </span>
      </div>

      {canWrite && editable ? (
        <TitleEditForm storyId={storyRow.id} title={storyRow.title} />
      ) : (
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{storyRow.title}</h1>
      )}

      {canWrite && editable && (
        <div className="mt-2">
          <RegenerateButton
            kind={storyRow.kind}
            anchor={storyRow.periodStart.toISOString().slice(0, 10)}
          />
        </div>
      )}

      <div className="mt-6 flex flex-col gap-4">
        {paragraphs.map((p) => (
          <article
            key={p.id}
            className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4"
          >
            {p.kind === "quote" ? (
              <blockquote className="border-l-2 border-foreground/20 pl-3 text-base leading-7 text-foreground/90">
                {p.text}
              </blockquote>
            ) : (
              <p className="whitespace-pre-wrap text-base leading-7 text-foreground/90">
                {p.text}
              </p>
            )}
            <p className="mt-2 text-xs text-foreground/45">
              来源：
              {p.sources.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && " / "}
                  {SOURCE_TYPE_LABEL[s.sourceType] ?? s.sourceType}
                </span>
              ))}
            </p>
            {canWrite && editable && (
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
          <p className="text-sm text-foreground/50">这个故事还没有段落。</p>
        )}
      </div>

      {canWrite && editable && <AddParagraphForm storyId={storyRow.id} />}
      {canWrite && storyRow.status !== "published" && (
        <div className="mt-6">
          <PublishForm storyId={storyRow.id} />
        </div>
      )}
      {storyRow.status === "published" && (
        <div className="mt-6 flex flex-col gap-2">
          <p className="text-xs text-foreground/45">
            已发布 · {storyRow.publishedAt ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(storyRow.publishedAt) : ""}
            ——发布版本不可再修改；再生成会另立新草稿。
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            <a
              href={`/api/books/story/${storyRow.id}?format=pdf`}
              className="rounded-lg border border-foreground/20 px-3 py-1.5 transition-colors hover:border-accent"
            >
              下载 PDF 书
            </a>
            <a
              href={`/api/books/story/${storyRow.id}?format=epub`}
              className="rounded-lg border border-foreground/20 px-3 py-1.5 transition-colors hover:border-accent"
            >
              下载 EPUB 书
            </a>
          </div>
          <p className="text-xs text-foreground/40">
            媒体与文字全部内嵌在文件里，可直接送给家人或在任何阅读器打开。
          </p>
        </div>
      )}
    </main>
  );
}
