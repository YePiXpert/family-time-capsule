import type { Metadata } from "next";
import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import {
  PROMPT_LIBRARY,
  listContributionRequests,
} from "@/lib/oral-history/service";
import { CloseRequestButton, RequestCreateForm } from "./request-ui";
import { listPeople } from "@/lib/family/service";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { StatusBadge } from "@/components/status-badge";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "口述收集 · Family Time Capsule" };

const STATUS_LABEL: Record<string, string> = {
  open: "开放中",
  closed: "已关闭",
};

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ personId?: string | string[] }>;
}) {
  const context = await requireFamily();
  const canCreate = hasFamilyCapability(context.role, "contribution:create");
  const requests = listContributionRequests(context);
  const people = await listPeople(context.familyId);
  const query = await searchParams;
  const requestedPersonId =
    typeof query.personId === "string" && people.some((person) => person.id === query.personId)
      ? query.personId
      : undefined;
  const personById = new Map(people.map((person) => [person.id, person]));
  const waiting = requests.filter(
    (request) => request.status === "open" && request.submissionCount === 0,
  );
  const received = requests.filter((request) => request.submissionCount > 0);
  const closedWithoutReply = requests.filter(
    (request) => request.status === "closed" && request.submissionCount === 0,
  );
  const topics = PROMPT_LIBRARY.map((t) => ({
    key: t.key,
    label: t.label,
    questions: [...t.questions],
  }));

  return (
    <main className="page-container max-w-5xl">
      <PageHeader
        eyebrow="Family voices"
        title="口述史"
        description="把一个具体问题发给家人，他们可以用文字、录音、照片或视频回答。回答先进入收件箱，经家人确认后才进入时间轴。"
      />

      {canCreate && (
        <section
          id="new-request"
          aria-label="创建讲述链接"
          className="mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-6"
        >
          <h2 className="text-base font-medium">新的提问</h2>
          <div className="mt-3">
            <RequestCreateForm
              topics={topics}
              people={people.map((person) => ({
                id: person.id,
                displayName: person.displayName,
                relationToChild: person.relationToChild,
              }))}
              defaultPersonId={requestedPersonId}
            />
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-foreground/60">
              内置问题库（点击展开参考）
            </summary>
            <dl className="mt-2 flex flex-col gap-2 text-sm">
              {topics.map((t) => (
                <div key={t.key}>
                  <dt className="font-medium text-foreground/70">{t.label}</dt>
                  <dd className="text-foreground/50">
                    {t.questions.map((q) => (
                      <span key={q} className="block">
                        · {q}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        </section>
      )}

      {requests.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            icon="microphone"
            title="还没有向家人发起问题"
            description="从一段童年、一座城市或一次家庭变化问起，具体问题通常比“讲讲过去”更容易回答。"
            action={canCreate ? "在上方发起第一个问题" : "浏览家人讲述"}
            actionHref={canCreate ? "#new-request" : "/timeline"}
          />
        </div>
      ) : (
        <div className="mt-10 space-y-10">
          {[
            { title: "等待回答", description: `${waiting.length} 个问题仍在等待家人的声音`, items: waiting },
            { title: "已经收到", description: "有回答的问题会保留在这里；待整理内容可直接进入收件箱", items: received },
          ].map((section) => (
            <section key={section.title} aria-label={section.title}>
              <SectionHeader title={section.title} description={section.description} />
              {section.items.length > 0 ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {section.items.map((request) => {
                    const person = request.recipientPersonId
                      ? personById.get(request.recipientPersonId)
                      : undefined;
                    return (
                      <article key={request.id} className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">给{request.recipientLabel}的提问</span>
                          <StatusBadge tone={request.status === "open" ? "success" : "neutral"}>
                            {STATUS_LABEL[request.status] ?? request.status}
                          </StatusBadge>
                        </div>
                        <p className="mt-2 text-base leading-7">{request.promptText}</p>
                        <p className="mt-2 text-xs text-muted">
                          {request.submissionCount > 0 ? `已收到 ${request.submissionCount} 条回答` : "等待家人回答"}
                          {request.pendingCount > 0 ? ` · ${request.pendingCount} 条等待整理` : ""}
                          {" · "}有效期至 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(request.expiresAt)}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          {request.pendingCount > 0 ? <Link href="/inbox" className="ui-button-primary">整理收到的回答</Link> : null}
                          {person ? <Link href={`/family/${person.id}`} className="ui-button-secondary">查看{person.displayName}的人物主页</Link> : null}
                          {request.status === "open" && canCreate ? <CloseRequestButton requestId={request.id} /> : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 rounded-xl border border-dashed border-line p-4 text-sm text-muted">
                  {section.title === "等待回答" ? "目前没有等待回答的问题，可以从上方再问一个。" : "回答到来后会显示在这里。"}
                </p>
              )}
            </section>
          ))}
          {closedWithoutReply.length > 0 ? (
            <details className="rounded-2xl border border-line bg-surface p-4">
              <summary className="min-h-11 py-2 font-medium">已结束且未收到回答（{closedWithoutReply.length}）</summary>
              <ul className="mt-3 space-y-2 text-sm text-muted">
                {closedWithoutReply.map((request) => <li key={request.id}>给{request.recipientLabel}：{request.promptText}</li>)}
              </ul>
            </details>
          ) : null}
        </div>
      )}
    </main>
  );
}
