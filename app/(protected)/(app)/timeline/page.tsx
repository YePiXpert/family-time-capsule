import { growthStage, growthStages, eventGrowthStage } from "@/mobile/src/design/growth-stages";
import { growthHeading } from "@/mobile/src/design/growth";
import { pendingImports } from "@/lib/home/pending";
import type { Metadata } from "next";
import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { getFamily, listPeople } from "@/lib/family/service";
import { getTimelineFacets, getTimelinePage } from "@/lib/memories/service";
import { countInbox } from "@/lib/inbox/service";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { formatPersonAgeLabel } from "@/lib/memories/age";
import { formatOccurredDateLabel, precisionHasDay, type OccurredAtPrecision } from "@/lib/metadata/precision";
import { zonedWallTimeToUtc } from "@/lib/metadata/time";
import { EmptyState } from "@/components/empty-state";
import { CollectionSelection } from "@/components/collection-selection";
import { MemoryCard } from "@/components/memory-card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "成长 · 小美成长记" };

type TimelineParams = Record<string, string | string[] | undefined>;

function value(params: TimelineParams, key: string): string {
  const found = params[key];
  return typeof found === "string" ? found : "";
}

function rangeFor(params: TimelineParams, timezone: string) {
  const month = value(params, "month");
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    const [year, monthNumber] = month.split("-").map(Number) as [number, number];
    const next = new Date(Date.UTC(year, monthNumber, 1));
    const nextMonth = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00`;
    return {
      from: zonedWallTimeToUtc(`${month}-01T00:00:00`, timezone),
      before: zonedWallTimeToUtc(nextMonth, timezone),
    };
  }
  const year = value(params, "year");
  if (/^\d{4}$/.test(year)) {
    return {
      from: zonedWallTimeToUtc(`${year}-01-01T00:00:00`, timezone),
      before: zonedWallTimeToUtc(`${Number(year) + 1}-01-01T00:00:00`, timezone),
    };
  }
  return { from: null, before: null };
}

function queryHref(params: TimelineParams, patch: Record<string, string | undefined>) {
  const next = new URLSearchParams();
  for (const key of ["person", "media", "tag", "month", "year", "collection", "cursor", "stage", "important"]) {
    const current = value(params, key);
    if (current) next.set(key, current);
  }
  for (const [key, updated] of Object.entries(patch)) {
    if (updated) next.set(key, updated);
    else next.delete(key);
  }
  const query = next.toString();
  return query ? `/timeline?${query}` : "/timeline";
}

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<TimelineParams>;
}) {
  const context = await requireFamily();
  const { familyId, role } = context;
  const params = await searchParams;
  const canReviewInbox = hasFamilyCapability(role, "inbox:review");
  const [family, people, facets, inboxCount] = await Promise.all([
    getFamily(familyId),
    listPeople(familyId),
    getTimelineFacets(familyId, context.familyTimezone),
    canReviewInbox ? countInbox(familyId) : Promise.resolve(0),
  ]);
  const pendingCount = inboxCount + pendingImports(context).length;
  const timezone = family?.timezone ?? "Asia/Shanghai";
  const growth = growthHeading(people, new Date(), timezone);
  const child = people.find(p => p.id === growth.childId);
  const stages = growthStages(child?.birthDate ?? null, new Date(), timezone);
  const stage = child?.birthDate && !value(params, "month") && !value(params, "year") ? growthStage(child.birthDate, value(params, "stage")) : null;
  const range = stage ? { from: zonedWallTimeToUtc(`${stage.from}T00:00:00`, timezone), before: zonedWallTimeToUtc(`${stage.before}T00:00:00`, timezone) } : rangeFor(params, timezone);
  const requestedMedia = value(params, "media");
  const mediaType = requestedMedia === "image" || requestedMedia === "audio" || requestedMedia === "video" || requestedMedia === "document" ? requestedMedia : null;
  const cursor = value(params, "cursor") || undefined;
  const selectedPerson = value(params, "person");
  const personId = people.some((person) => person.id === selectedPerson) ? selectedPerson : null;
  const timelinePage = await getTimelinePage(context, {
    cursor,
    personId,
    growthChildId: stage ? growth.childId : null,
    growthDayOnly: Boolean(stage),
    milestoneOnly: value(params, "important") === "1",
    mediaType,
    tag: value(params, "tag").slice(0, 100) || null,
    occurredFrom: range.from,
    occurredBefore: range.before,
  });
  const entries = timelinePage.entries;
  const monthFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", timeZone: timezone });
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const ageStage = child?.birthDate && (entry.event.childPersonId ? entry.event.childPersonId === child.id : entry.participantIds?.length ? entry.participantIds.includes(child.id) : people.filter(p => p.isChild).length === 1) ? eventGrowthStage(child.birthDate, entry.event.occurredAt.toISOString(), entry.event.occurredAtPrecision, timezone) : null;
    const month = entry.event.occurredAtPrecision === "unknown" ? "时间待补充" : ageStage?.label ?? monthFormatter.format(entry.event.occurredAt);
    const list = groups.get(month) ?? [];
    list.push(entry);
    groups.set(month, list);
  }
  const hasFilters = ["person", "media", "tag", "month", "year", "collection", "stage", "important"].some((key) => value(params, key));
  const monthActive = /^\d{4}-(0[1-9]|1[0-2])$/.test(value(params, "month"));

  return (
    <main className="page-container growth-page">
      <section className="growth-hero" aria-label="成长概览">
        <div className="growth-mark" aria-hidden="true">✿</div>
        <div className="min-w-0 flex-1"><p className="page-eyebrow">一点一滴，慢慢长大</p><h1>{growth.title}</h1><p className="growth-dedication">留下今天，送给长大的你。</p>{growth.age ? <p className="growth-age">{growth.age}</p> : null}</div>
      </section>
      {stages.length ? <nav aria-label="按月龄回看" className="growth-stage-nav">
        <Link href={queryHref(params, { stage: undefined, cursor: undefined, month: undefined, year: undefined })} aria-current={!stage ? "page" : undefined} className={!stage ? "ui-button-primary" : "ui-button-secondary"}>全部</Link>
        {stages.map(item => <Link key={item.key} href={queryHref(params, { stage: item.key, cursor: undefined, month: undefined, year: undefined })} aria-current={stage?.key === item.key ? "page" : undefined} className={stage?.key === item.key ? "ui-button-primary" : "ui-button-secondary"}>{item.label}</Link>)}
      </nav> : <p className="mb-4 text-sm text-muted">填写宝宝生日后，就能按月龄回看。<Link href="/family" className="ui-text-link ml-2">查看孩子档案</Link></p>}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><Link href={queryHref(params, { important: value(params, "important") === "1" ? undefined : "1", cursor: undefined })} className="ui-text-link">{value(params, "important") === "1" ? "查看所有时刻" : "第一次与值得记住"}</Link><Link href="/books" className="ui-text-link">看看{growth.childName}的成长册</Link></div>
      <div className="flex items-center justify-between gap-4"><h2 className="text-xl font-semibold">成长点滴</h2><Link href="/search" aria-label="搜索家庭记忆" className="ui-button-secondary">搜索</Link></div>

      {pendingCount > 0 ? <Link href="/pending" className="ui-text-link mt-3">待处理 {pendingCount > 99 ? "99+" : pendingCount} 条</Link> : null}
      <details aria-label="筛选时间轴" className="mt-4 rounded-2xl border border-line bg-surface p-3" open={hasFilters}>
        <summary className="min-h-11 cursor-pointer py-2">筛选{hasFilters ? " · 已启用" : ""}</summary>
        <Link href="/timeline/calendar" className="ui-text-link mb-3">在日历中选择日期</Link>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" action="/timeline">
          <input type="hidden" name="stage" value={stage?.key ?? ""} /><input type="hidden" name="important" value={value(params, "important")} />
          <input type="hidden" name="collection" value={value(params, "collection")} />
          <label className="text-sm font-medium">跳到月份<input type="month" name="month" defaultValue={value(params, "month")} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-background px-3" /></label>
          <label className="text-sm font-medium">跳到年份<select name="year" defaultValue={monthActive ? "" : value(params, "year")} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-background px-3"><option value="">全部年份</option>{facets.years.map((year) => <option key={year} value={year}>{year} 年</option>)}</select></label>
          <label className="text-sm font-medium">人物<select name="person" defaultValue={personId ?? ""} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-background px-3"><option value="">所有家人</option>{people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>
          <label className="text-sm font-medium">媒体<select name="media" defaultValue={mediaType ?? ""} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-background px-3"><option value="">所有类型</option><option value="image">照片</option><option value="video">视频</option><option value="audio">录音</option><option value="document">文档</option></select></label>
          <label className="text-sm font-medium">标签<select name="tag" defaultValue={value(params, "tag")} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-background px-3"><option value="">所有标签</option>{facets.tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-5"><button type="submit" className="ui-button-primary">查看</button>{hasFilters ? <Link href="/timeline" className="ui-button-secondary">清除筛选</Link> : null}</div>
        </form>
          {hasFamilyCapability(role, "event:write") ? <CollectionSelection summaryLabel="选择记忆" memories={entries.map(e=>({id:e.event.id,title:e.event.title}))} initialCollection={value(params,"collection")} /> : null}
      </details>

      {entries.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon="timeline"
            title={hasFilters || cursor ? "没有符合条件的记忆" : "时间轴还在等第一件事"}
            description={hasFilters || cursor ? "换一个月份、人物或媒体类型，也可以回到全部记忆。" : "写一句话或选一张照片，保存后在这里回看。"}
            action={hasFilters || cursor ? "回到全部记忆" : "记录第一件事"}
            actionHref={hasFilters || cursor ? "/timeline" : "/capture"}
            secondary={canReviewInbox && inboxCount > 0 ? <Link href="/inbox" className="ui-text-link">查看待处理内容</Link> : undefined}
          />
        </div>
      ) : (
        <div className="mt-8 space-y-10">

          {[...groups.entries()].map(([month, list]) => (
            <section key={month} aria-label={month}>
              <div className="flex items-center gap-3"><h2 className="text-sm font-semibold tracking-[0.16em] text-muted">{month}</h2><span className="h-px flex-1 bg-line" /></div>
              <ol className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-2">
                {list.map(({ event, coverAssetId, coverAssetType, coverAssetMime, coverThumbAssetId, assetCount, participantNames }) => (
                  <li key={event.id} className="min-w-0">
                    <MemoryCard id={event.id} title={event.title} bodyText={event.bodyText} dateLabel={formatOccurredDateLabel(event.occurredAtPrecision as OccurredAtPrecision, event.occurredAt, timezone)} ageLabel={precisionHasDay(event.occurredAtPrecision as OccurredAtPrecision) ? formatPersonAgeLabel(people.find(p => p.id === event.childPersonId), event.occurredAt, timezone) : null} location={event.locationText} people={participantNames} assetCount={assetCount} milestoneType={event.milestoneType} isPinned={event.isPinned} cover={coverAssetId ? { assetId: coverAssetId, type: coverAssetType, mimeType: coverAssetMime ?? "application/octet-stream", thumbAssetId: coverThumbAssetId } : null} />
                  </li>
                ))}
              </ol>
            </section>
          ))}
          <nav aria-label="时间轴分页" className="flex items-center justify-between gap-4">
            {cursor ? <Link href={queryHref(params, { cursor: undefined })} className="ui-button-secondary">回到本次筛选最新</Link> : <span />}
            {timelinePage.nextCursor ? <Link href={queryHref(params, { cursor: timelinePage.nextCursor })} rel="next" className="ui-button-secondary">查看更早的记忆</Link> : null}
          </nav>
        </div>
      )}
    </main>
  );
}
