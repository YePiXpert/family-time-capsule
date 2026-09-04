import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { MemoryCard } from "@/components/memory-card";
import { PageHeader } from "@/components/page-header";
import { QuickAction } from "@/components/quick-action";
import { requireFamily } from "@/lib/family/context";
import { getFamily, listPeople } from "@/lib/family/service";
import { formatAgeLabel } from "@/lib/memories/age";
import { getResurfacing } from "@/lib/memories/resurfacing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "记忆回顾 · Family Time Capsule" };

export default async function ResurfacingPage() {
  const context = await requireFamily();
  const [family, people] = await Promise.all([
    getFamily(context.familyId),
    listPeople(context.familyId),
  ]);
  if (!family) throw new Error("authorized family is unavailable");
  const result = await getResurfacing(context.familyId, family.timezone, new Date(), 8);
  const child = people.find((person) => person.isChild);
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "long",
    timeZone: family.timezone,
  });

  return (
    <main className="page-container max-w-6xl">
      <PageHeader
        backHref="/"
        backLabel="返回首页"
        eyebrow="重新遇见"
        title="记忆回顾"
        description="按家庭所在时区，找回同月同日、一个月前、百天前与一年前的生活。"
        actions={<Link href="/timeline" className="ui-button-secondary">浏览完整时间轴</Link>}
      />

      {!result.hasHistory ? (
        <div className="mt-8">
          <EmptyState
            icon="spark"
            title="还没有到重逢的时候"
            description="这不是缺失：留下今天后，记忆会在未来恰当的日子回来。旧照片按真实发生时间入档，也会加入回顾。"
            action="留下今天"
            actionHref="/capture"
            secondary={<Link href="/timeline" className="ui-text-link">继续浏览时间轴</Link>}
          />
        </div>
      ) : (
        <div className="mt-10 space-y-12">
          {result.groups.map((group) => (
            <section key={group.kind} aria-labelledby={`resurfacing-${group.kind}`}>
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
                <div>
                  <p className="page-eyebrow">{group.targetDate}</p>
                  <h2 id={`resurfacing-${group.kind}`} className="mt-1 text-xl font-semibold">
                    {group.label}
                  </h2>
                  <p className="mt-1 text-sm text-muted">{group.description}</p>
                </div>
                <span className="text-sm text-muted">{group.entries.length} 段</span>
              </div>
              {group.entries.length > 0 ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.entries.map((entry) => (
                    <MemoryCard
                      key={entry.event.id}
                      id={entry.event.id}
                      title={entry.event.title}
                      dateLabel={formatter.format(entry.event.occurredAt)}
                      ageLabel={child?.birthDate ? formatAgeLabel(child.birthDate, entry.event.occurredAt) : null}
                      location={entry.event.locationText}
                      people={entry.participantNames}
                      assetCount={entry.assetCount}
                      milestoneType={entry.event.milestoneType}
                      isPinned={entry.event.isPinned}
                      cover={entry.coverAssetId ? {
                        assetId: entry.coverAssetId,
                        type: entry.coverAssetType,
                        mimeType: entry.coverAssetMime ?? "application/octet-stream",
                        thumbAssetId: entry.coverThumbAssetId,
                      } : null}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-4 max-w-md">
                  <QuickAction
                    href="/timeline"
                    icon="timeline"
                    label={`${group.label}暂无片段`}
                    description="打开时间轴继续看看其他日子"
                  />
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
