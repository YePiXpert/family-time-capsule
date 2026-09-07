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
import { listResurfacingPreferences } from "@/lib/memories/resurfacing-preferences";
import { blockDateRangeAction, blockEventAction, blockPersonAction, pauseResurfacingAction, unblockAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "记忆回顾 · Family Time Capsule" };

export default async function ResurfacingPage() {
  const context = await requireFamily();
  const [family, people] = await Promise.all([
    getFamily(context.familyId),
    listPeople(context.familyId),
  ]);
  if (!family) throw new Error("authorized family is unavailable");
  const [result, preferences] = await Promise.all([
    getResurfacing(context.familyId, family.timezone, new Date(), 8, context),
    listResurfacingPreferences(context),
  ]);
  const paused = preferences.some((preference) => preference.kind === "pause");
  const blockedEventIds = new Set(preferences.filter((p) => p.kind === "event").map((p) => p.targetKey));
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

      <section aria-labelledby="resurfacing-preferences" className="mt-6 rounded-xl border border-line bg-surface p-4">
        <h2 id="resurfacing-preferences" className="text-base font-semibold">回顾偏好（只影响你自己的自动回顾）</h2>
        <p className="mt-1 text-sm text-muted">屏蔽不会删除任何内容，也不影响搜索和主动打开；其他家人不受影响。</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <form action={pauseResurfacingAction}>
            <button className="ui-button-secondary" type="submit">{paused ? "回顾已暂停" : "暂停回顾"}</button>
          </form>
          {paused ? (
            <form action={unblockAction}>
              <input type="hidden" name="preferenceId" value={preferences.find((p) => p.kind === "pause")!.id} />
              <button className="ui-button-secondary" type="submit">恢复回顾</button>
            </form>
          ) : null}
          <form action={blockDateRangeAction} className="flex flex-wrap items-center gap-2">
            <label className="text-sm">不再推荐这段时间
              <input type="date" name="dateFrom" required className="ml-2 min-h-11 rounded-lg border border-line px-2" aria-label="屏蔽开始日期" />
              至
              <input type="date" name="dateTo" className="min-h-11 rounded-lg border border-line px-2" aria-label="屏蔽结束日期（可留空）" />
            </label>
            <button className="ui-button-secondary" type="submit">屏蔽日期</button>
          </form>
          <form action={blockPersonAction} className="flex items-center gap-2">
            <label className="text-sm">不再推荐某个人物
              <select name="personId" className="ml-2 min-h-11 rounded-lg border border-line px-2" aria-label="选择要屏蔽的人物">
                {people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
              </select>
            </label>
            <button className="ui-button-secondary" type="submit">屏蔽人物</button>
          </form>
        </div>
        {preferences.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm text-muted">
            {preferences.map((preference) => (
              <li key={preference.id} className="flex items-center gap-3">
                <span>{preference.kind === "pause" ? "已暂停回顾" : preference.kind === "event" ? "暂不推荐某件事" : preference.kind === "person" ? "已屏蔽某人物" : `已屏蔽 ${preference.dateFrom} ~ ${preference.dateTo ?? preference.dateFrom}`}</span>
                <form action={unblockAction}>
                  <input type="hidden" name="preferenceId" value={preference.id} />
                  <button className="ui-text-link" type="submit">取消</button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
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
                    <div key={entry.event.id} className="space-y-2">
                    <MemoryCard
                      key={entry.event.id}
                      id={entry.event.id}
                      title={entry.event.title}
                      dateLabel={formatter.format(entry.event.occurredAt)}
                      ageLabel={child?.birthDate ? formatAgeLabel(child.birthDate, entry.event.occurredAt, family.timezone) : null}
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
                      <form action={blockEventAction} className="text-sm">
                        <input type="hidden" name="eventId" value={entry.event.id} />
                        <button type="submit" className="ui-text-link">暂不推荐这件事</button>
                      </form>
                    </div>
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
