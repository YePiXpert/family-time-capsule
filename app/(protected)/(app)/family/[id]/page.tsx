import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { MemoryCard } from "@/components/memory-card";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { StatusBadge } from "@/components/status-badge";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { requireFamily } from "@/lib/family/context";
import { getPersonProfile } from "@/lib/family/profile";
import { getFamily } from "@/lib/family/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "人物主页 · Family Time Capsule" };

const VISIBILITY_LABEL: Record<string, string> = {
  private: "仅自己",
  parents: "父母可见",
  family: "全家可见",
  child_later: "长大后可见",
};

export default async function PersonProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireFamily();
  const { id } = await params;
  const [profile, family] = await Promise.all([
    getPersonProfile(context, id),
    getFamily(context.familyId),
  ]);
  if (!profile) notFound();
  const timezone = family?.timezone ?? "Asia/Shanghai";
  const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeZone: timezone,
  });
  const canAsk = hasFamilyCapability(context.role, "contribution:create");
  const memories = profile.participatingMemories;

  return (
    <main className="page-container max-w-5xl">
      <PageHeader
        backHref="/family"
        backLabel="返回家人"
        eyebrow={profile.person.isChild ? "成长中的主角" : profile.person.relationToChild || "家人"}
        title={profile.person.displayName}
        description={
          profile.person.birthDate
            ? `生于 ${profile.person.birthDate}`
            : "把一起经历的事和亲口讲述留在同一个地方"
        }
        actions={
          canAsk ? (
            <Link
              href={`/requests?personId=${encodeURIComponent(profile.person.id)}`}
              className="ui-button-primary"
            >
              问 TA 一个问题
            </Link>
          ) : undefined
        }
      />

      {!profile.person.isChild ? (
        <section className="mt-10" aria-label="与孩子的共同记忆">
          <SectionHeader
            title="和孩子一起"
            description="共同出现过的家庭片段"
            actionHref={`/timeline?person=${encodeURIComponent(profile.person.id)}`}
            actionLabel="查看全部"
          />
          {profile.sharedWithChildren.length > 0 ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {profile.sharedWithChildren.slice(0, 4).map((entry) => (
                <MemoryCard
                  key={entry.event.id}
                  id={entry.event.id}
                  title={entry.event.title}
                  dateLabel={dateFormatter.format(entry.event.occurredAt)}
                  location={entry.event.locationText}
                  people={entry.participantNames}
                  assetCount={entry.assetCount}
                  milestoneType={entry.event.milestoneType}
                  isPinned={entry.event.isPinned}
                  compact
                  cover={
                    entry.coverAssetId
                      ? {
                          assetId: entry.coverAssetId,
                          type: entry.coverAssetType,
                          mimeType: entry.coverAssetMime ?? "application/octet-stream",
                          thumbAssetId: entry.coverThumbAssetId,
                        }
                      : null
                  }
                />
              ))}
            </div>
          ) : (
            <div className="mt-3">
              <EmptyState
                icon="people"
                title="还没有一起出现的记忆"
                description="整理记忆时把这位家人选为参与人，共同经历就会来到这里。"
                action="整理收件箱"
                actionHref="/inbox"
              />
            </div>
          )}
        </section>
      ) : null}

      <section className="mt-10" aria-label="参与的记忆">
        <SectionHeader
          title={profile.person.isChild ? "成长记忆" : "参与的记忆"}
          description={`共找到 ${memories.length} 段近期记忆`}
          actionHref={`/timeline?person=${encodeURIComponent(profile.person.id)}`}
          actionLabel="打开时间轴"
        />
        {memories.length > 0 ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {memories.slice(0, profile.person.isChild ? 6 : 4).map((entry) => (
              <MemoryCard
                key={entry.event.id}
                id={entry.event.id}
                title={entry.event.title}
                dateLabel={dateFormatter.format(entry.event.occurredAt)}
                location={entry.event.locationText}
                people={entry.participantNames}
                assetCount={entry.assetCount}
                milestoneType={entry.event.milestoneType}
                isPinned={entry.event.isPinned}
                compact
                cover={
                  entry.coverAssetId
                    ? {
                        assetId: entry.coverAssetId,
                        type: entry.coverAssetType,
                        mimeType: entry.coverAssetMime ?? "application/octet-stream",
                        thumbAssetId: entry.coverThumbAssetId,
                      }
                    : null
                }
              />
            ))}
          </div>
        ) : null}
      </section>

      <section className="mt-10" aria-label="自己的讲述">
        <SectionHeader
          title="亲口讲述"
          description="在家庭记忆中留下的独立视角"
        />
        {profile.narratives.length > 0 ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {profile.narratives.map((narrative) => (
              <Link
                key={narrative.id}
                href={`/memories/${narrative.memoryEventId}`}
                className="rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-accent/50"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">{narrative.memoryTitle}</h3>
                  <StatusBadge tone="neutral">
                    {VISIBILITY_LABEL[narrative.visibility] ?? "家庭讲述"}
                  </StatusBadge>
                </div>
                <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-muted">
                  {narrative.text}
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="mt-3">
            <EmptyState
              icon="edit"
              title="还没有留下亲口讲述"
              description="打开一段共同记忆，可以补上这位家人当时看到和感受到的事。"
              action={memories[0] ? "从一段记忆开始" : "浏览时间轴"}
              actionHref={memories[0] ? `/memories/${memories[0].event.id}` : "/timeline"}
            />
          </div>
        )}
      </section>

      <section className="mt-10" aria-label="口述史">
        <SectionHeader
          title="口述史问题"
          description="专门发给这位家人的家庭讲述邀请"
          actionHref={canAsk ? `/requests?personId=${encodeURIComponent(profile.person.id)}` : "/requests"}
          actionLabel={canAsk ? "发起一个问题" : "查看口述史"}
        />
        {profile.oralHistoryRequests.length > 0 ? (
          <div className="mt-3 space-y-3">
            {profile.oralHistoryRequests.map((request) => (
              <Link
                key={request.id}
                href="/requests"
                className="flex min-h-16 items-start justify-between gap-4 rounded-2xl border border-line bg-surface p-4 hover:border-accent/50"
              >
                <span>
                  <span className="block font-medium">{request.promptText}</span>
                  <span className="mt-1 block text-xs text-muted">
                    已收到 {request.submissionCount} 条 · 待整理 {request.pendingCount} 条
                  </span>
                </span>
                <StatusBadge tone={request.status === "open" ? "success" : "neutral"}>
                  {request.status === "open" ? "待回答" : "已结束"}
                </StatusBadge>
              </Link>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
