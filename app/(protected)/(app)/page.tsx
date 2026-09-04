import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { InlineNotice } from "@/components/inline-notice";
import { MediaImage } from "@/components/media-view";
import { MemoryCard } from "@/components/memory-card";
import { QuickAction } from "@/components/quick-action";
import { SectionHeader } from "@/components/section-header";
import { StatusBadge } from "@/components/status-badge";
import { Icon } from "@/components/ui/icons";
import { requireFamily } from "@/lib/family/context";
import { getHomeDashboard } from "@/lib/home/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "首页 · Family Time Capsule" };

const INBOX_STATUS_LABEL: Record<string, string> = {
  new: "待整理",
  needs_review: "待校时",
  processing: "处理中",
};

const STORY_KIND_LABEL: Record<string, string> = {
  weekly: "周记",
  monthly: "月章",
  yearly: "年章",
};

const STORY_STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  edited: "已编辑",
  published: "已发布",
};

type Dashboard = Awaited<ReturnType<typeof getHomeDashboard>>;

function capsuleUnlockLabel(capsule: NonNullable<Dashboard["upcomingCapsule"]>) {
  if (capsule.unlocked) return "已经可以开启";
  return capsule.unlockType === "date"
    ? `${capsule.unlockValue} 开启`
    : `孩子 ${capsule.unlockValue} 岁开启`;
}

export default async function HomePage() {
  const context = await requireFamily();
  const dashboard = await getHomeDashboard(context);
  const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "long",
    timeZone: dashboard.family.timezone,
  });

  return (
    <main className="page-container">
      <section className="home-hero">
        <Link href="/family" className="home-avatar" aria-label="查看家人">
          {dashboard.child?.avatar ? (
            <MediaImage
              assetId={dashboard.child.avatar.assetId}
              mimeType={dashboard.child.avatar.mimeType}
              thumbAssetId={dashboard.child.avatar.thumbAssetId}
              alt={`${dashboard.child.displayName}的头像`}
              className="h-full w-full"
              imgClassName="h-full w-full object-cover"
            />
          ) : (
            <span aria-hidden="true">
              {dashboard.child?.displayName.slice(0, 1) ??
                dashboard.family.name.slice(0, 1)}
            </span>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <p className="page-eyebrow">一家人的今天</p>
          <h1 className="mt-1 truncate text-3xl font-semibold tracking-tight sm:text-4xl">
            {dashboard.family.name}
          </h1>
          <p className="mt-2 text-sm text-muted sm:text-base">
            {dashboard.child ? (
              <>
                {dashboard.child.displayName}
                {dashboard.child.currentAgeLabel
                  ? ` · ${dashboard.child.currentAgeLabel}`
                  : ""}
              </>
            ) : (
              "从第一段家庭记忆开始"
            )}
          </p>
        </div>
        {dashboard.canCapture ? (
          <Link href="/capture" className="ui-button-primary hidden sm:inline-flex">
            <Icon name="capture" size={19} className="mr-2" />
            记录此刻
          </Link>
        ) : null}
      </section>

      {dashboard.canCapture ? (
        <section className="mt-8" aria-label="快速记录">
          <SectionHeader
            title="快速记录"
            description="先留下，细节可以稍后整理"
          />
          <div
            id="quick-capture-title"
            className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4"
          >
            <QuickAction href="/capture#text" icon="edit" label="写一句" />
            <QuickAction href="/capture#photo" icon="image" label="拍照" />
            <QuickAction href="/capture#audio" icon="microphone" label="录音" />
            <QuickAction href="/capture#media" icon="upload" label="导入" />
          </div>
        </section>
      ) : (
        <div className="mt-8">
          <InlineNotice title="当前是只读浏览">
            你可以继续查看时间轴、故事和家人讲述；需要记录新内容时，请联系家庭管理员调整账号角色。
            <Link href="/timeline" className="ui-text-link ml-2">
              浏览时间轴
            </Link>
          </InlineNotice>
        </div>
      )}

      {dashboard.isFirstUse ? (
        <section className="mt-10 rounded-2xl border border-accent/25 bg-accent-soft p-5 sm:p-6">
          <SectionHeader
            title="把第一段记忆带回家"
            description="从最轻松的一步开始，资料会一直留在你的家庭服务器。"
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {dashboard.canCapture ? (
              <QuickAction
                href="/capture#text"
                icon="edit"
                label="写下第一句话"
                description="不用先整理标题和人物"
              />
            ) : null}
            <QuickAction
              href="/family"
              icon="people"
              label="补全家人"
              description="人物不需要登录账号"
            />
            <QuickAction
              href="/requests"
              icon="microphone"
              label="问家人一个问题"
              description="从口述史开始收集"
            />
          </div>
        </section>
      ) : null}

      <div className="mt-10 grid min-w-0 gap-10 xl:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.85fr)] xl:gap-8">
        <div className="min-w-0 space-y-10">
          <section aria-label="最近记忆">
            <SectionHeader
              title="最近记忆"
              actionLabel="查看时间轴"
              actionHref="/timeline"
            />
            {dashboard.recentMemories.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title="时间轴正等着第一段记忆"
                  description={
                    dashboard.inbox.count > 0
                      ? "收件箱里已经有素材，确认后它们会按真实发生时间来到这里。"
                      : "写一句话或导入一张旧照片，之后再慢慢补上故事。"
                  }
                  icon="timeline"
                  action={
                    dashboard.inbox.count > 0
                      ? "整理收件箱"
                      : dashboard.canCapture
                        ? "记录第一段记忆"
                        : "认识时间轴"
                  }
                  actionHref={
                    dashboard.inbox.count > 0
                      ? "/inbox"
                      : dashboard.canCapture
                        ? "/capture"
                        : "/timeline"
                  }
                />
              </div>
            ) : (
              <div
                id="recent-memory-title"
                className="mt-3 grid gap-3 md:grid-cols-2"
              >
                {dashboard.recentMemories.map((memory) => (
                  <MemoryCard
                    key={memory.id}
                    id={memory.id}
                    title={memory.title}
                    dateLabel={dateFormatter.format(memory.occurredAt)}
                    ageLabel={memory.ageLabel}
                    location={memory.locationText}
                    people={memory.participantNames}
                    assetCount={memory.assetCount}
                    milestoneType={memory.milestoneType}
                    isPinned={memory.isPinned}
                    cover={memory.cover}
                    compact
                  />
                ))}
              </div>
            )}
          </section>

          <section aria-label="这一天">
            <SectionHeader
              title="这一天"
              description="重新遇见发生在同月同日的家庭片段"
              actionLabel="打开记忆回顾"
              actionHref="/memories/resurfacing"
            />
            {dashboard.onThisDay.length > 0 ? (
              <div
                id="on-this-day-title"
                className="mt-3 grid gap-3 md:grid-cols-2"
              >
                {dashboard.onThisDay.map((memory) => (
                  <MemoryCard
                    key={memory.id}
                    id={memory.id}
                    title={memory.title}
                    dateLabel={dateFormatter.format(memory.occurredAt)}
                    ageLabel={memory.ageLabel}
                    location={memory.locationText}
                    people={memory.participantNames}
                    assetCount={memory.assetCount}
                    milestoneType={memory.milestoneType}
                    isPinned={memory.isPinned}
                    cover={memory.cover}
                    compact
                  />
                ))}
              </div>
            ) : (
              <div className="mt-3">
                <QuickAction
                  href="/memories/resurfacing"
                  icon="spark"
                  label="今天还没有历史回声"
                  description={
                    "看看一个月前、百天前和一年前，也可以留下今天"
                  }
                />
              </div>
            )}
          </section>

          <section aria-label="成长节点">
            <SectionHeader
              title="成长节点"
              description="置顶与特别标记的家庭时刻"
              actionLabel={dashboard.milestones.length > 0 ? "查看时间轴" : "标记一段记忆"}
              actionHref={dashboard.milestones.length > 0 ? "/timeline" : dashboard.recentMemories[0] ? `/memories/${dashboard.recentMemories[0].id}?mode=edit` : "/capture"}
            />
            {dashboard.milestones.length > 0 ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {dashboard.milestones.map((memory) => (
                  <MemoryCard
                    key={memory.id}
                    id={memory.id}
                    title={memory.title}
                    dateLabel={dateFormatter.format(memory.occurredAt)}
                    ageLabel={memory.ageLabel}
                    location={memory.locationText}
                    people={memory.participantNames}
                    assetCount={memory.assetCount}
                    milestoneType={memory.milestoneType}
                    isPinned={memory.isPinned}
                    cover={memory.cover}
                    compact
                  />
                ))}
              </div>
            ) : (
              <div className="mt-3">
                <QuickAction
                  href={dashboard.recentMemories[0] ? `/memories/${dashboard.recentMemories[0].id}?mode=edit` : "/capture"}
                  icon="spark"
                  label="标记第一次、成长或家庭时刻"
                  description="节点仍是一段普通记忆；模板可选，不增加额外记录负担"
                />
              </div>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-8" aria-label="家庭待办与成品">
          <section>
            <SectionHeader
              title="待整理"
              actionLabel="进入收件箱"
              actionHref="/inbox"
              trailing={
                <StatusBadge
                  tone={dashboard.inbox.count > 0 ? "warning" : "neutral"}
                >
                  {dashboard.inbox.count} 条
                </StatusBadge>
              }
            />
            <Link
              href="/inbox"
              className="mt-3 block overflow-hidden rounded-2xl border border-line bg-surface p-3 transition-colors hover:border-accent/50"
            >
              {dashboard.inbox.previews.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {dashboard.inbox.previews.map((preview) => (
                    <div
                      key={preview.id}
                      className="relative flex aspect-[4/3] min-w-0 items-center justify-center overflow-hidden rounded-xl bg-surface-muted"
                    >
                      {preview.media?.type === "image" ? (
                        <MediaImage
                          assetId={preview.media.assetId}
                          mimeType={preview.media.mimeType}
                          thumbAssetId={preview.media.thumbAssetId}
                          alt=""
                          className="h-full w-full"
                          imgClassName="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center text-muted">
                          <Icon
                            name={
                              preview.media?.type === "audio"
                                ? "audio"
                                : preview.media?.type === "video"
                                  ? "video"
                                  : "edit"
                            }
                          />
                          <span className="line-clamp-2 text-xs">
                            {preview.title}
                          </span>
                        </div>
                      )}
                      <span className="absolute bottom-1.5 left-1.5 rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-semibold text-foreground">
                        {INBOX_STATUS_LABEL[preview.status] ?? "待整理"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-28 items-center gap-3 p-3">
                  <span className="empty-state-icon">
                    <Icon name="inbox" />
                  </span>
                  <div>
                    <p className="font-medium">收件箱已经整理好</p>
                    <p className="mt-1 text-sm text-muted">
                      新素材会先安全地来到这里
                    </p>
                  </div>
                </div>
              )}
            </Link>
          </section>

          <section>
            <SectionHeader
              title="最近故事"
              actionLabel="全部故事"
              actionHref="/stories"
            />
            {dashboard.recentStory ? (
              <Link
                href={`/stories/${dashboard.recentStory.id}`}
                className="paper-feature-card mt-3"
              >
                <span className="page-eyebrow">
                  {STORY_KIND_LABEL[dashboard.recentStory.kind] ?? "家庭故事"}
                </span>
                <h3 className="mt-3 text-xl font-semibold leading-7">
                  {dashboard.recentStory.title}
                </h3>
                <p className="mt-3 text-sm text-muted">
                  {STORY_STATUS_LABEL[dashboard.recentStory.status] ??
                    dashboard.recentStory.status} · {dashboard.recentStory.paragraphCount} 段
                </p>
                <span className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-accent">
                  打开阅读
                  <Icon name="chevron-right" size={17} className="ml-1" />
                </span>
              </Link>
            ) : (
              <div className="mt-3">
                <QuickAction
                  href="/stories"
                  icon="story"
                  label="还没有家庭故事"
                  description="从已确认的记忆组装第一篇周记或月章"
                />
              </div>
            )}
          </section>

          <section>
            <SectionHeader
              title="时间胶囊"
              actionLabel="全部胶囊"
              actionHref="/capsules"
            />
            <div className="mt-3">
              {dashboard.upcomingCapsule ? (
                <QuickAction
                  href={`/capsules/${dashboard.upcomingCapsule.id}`}
                  icon="capsule"
                  label={dashboard.upcomingCapsule.title}
                  description={`${capsuleUnlockLabel(dashboard.upcomingCapsule)} · ${dashboard.upcomingCapsule.itemCount} 份内容`}
                />
              ) : (
                <QuickAction
                  href="/capsules"
                  icon="capsule"
                  label="封存一段给未来的话"
                  description="按日期或孩子年龄开启"
                />
              )}
            </div>
          </section>

          <section>
            <SectionHeader
              title="问问家人"
              actionLabel="口述史"
              actionHref="/requests"
            />
            <Link
              href="/requests"
              className="mt-3 block rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-accent/50"
            >
              <Icon name="microphone" className="text-accent" />
              <p className="mt-3 text-base font-medium leading-7">
                {dashboard.familyPrompt.text}
              </p>
              <p className="mt-3 text-sm text-muted">
                {dashboard.familyPrompt.isCreatedRequest
                  ? `给${dashboard.familyPrompt.recipientLabel} · ${dashboard.familyPrompt.pendingCount} 条待整理回答`
                  : "从问题库选择，也可以写自己的问题"}
              </p>
            </Link>
          </section>
        </aside>
      </div>
    </main>
  );
}
