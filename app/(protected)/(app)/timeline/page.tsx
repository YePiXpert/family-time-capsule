import type { Metadata } from "next";
import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { getFamily, listPeople } from "@/lib/family/service";
import { getTimelineFacets, getTimelinePage } from "@/lib/memories/service";
import { formatAgeLabel } from "@/lib/memories/age";
import { zonedWallTimeToUtc } from "@/lib/metadata/time";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { MemoryCard } from "@/components/memory-card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "时光轴 · Family Time Capsule" };

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
  for (const key of ["person", "media", "tag", "month", "year", "cursor"]) {
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
  const { familyId } = await requireFamily();
  const params = await searchParams;
  const [family, people, facets] = await Promise.all([
    getFamily(familyId),
    listPeople(familyId),
    getTimelineFacets(familyId),
  ]);
  const timezone = family?.timezone ?? "Asia/Shanghai";
  const range = rangeFor(params, timezone);
  const requestedMedia = value(params, "media");
  const mediaType = requestedMedia === "image" || requestedMedia === "audio" || requestedMedia === "video" ? requestedMedia : null;
  const cursor = value(params, "cursor") || undefined;
  const selectedPerson = value(params, "person");
  const personId = people.some((person) => person.id === selectedPerson) ? selectedPerson : null;
  const timelinePage = await getTimelinePage(familyId, {
    cursor,
    personId,
    mediaType,
    tag: value(params, "tag").slice(0, 100) || null,
    occurredFrom: range.from,
    occurredBefore: range.before,
  });
  const entries = timelinePage.entries;
  const child = people.find((person) => person.isChild);
  const dateFormatter = new Intl.DateTimeFormat("zh-CN", { dateStyle: "long", timeZone: timezone });
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const month = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", timeZone: timezone }).format(entry.event.occurredAt);
    const list = groups.get(month) ?? [];
    list.push(entry);
    groups.set(month, list);
  }
  const hasFilters = ["person", "media", "tag", "month", "year"].some((key) => value(params, key));

  return (
    <main className="page-container">
      <PageHeader eyebrow="Timeline" title="时光轴" description={`${child?.displayName ?? "孩子"}的成长记忆按真实发生时间排列；晚上传的旧照片仍会回到它属于的那一天。`} />

      <section aria-label="筛选时间轴" className="mt-6 rounded-2xl border border-line bg-surface p-4">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" action="/timeline">
          <label className="text-sm font-medium">跳到月份<input type="month" name="month" defaultValue={value(params, "month")} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-background px-3" /></label>
          <label className="text-sm font-medium">跳到年份<select name="year" defaultValue={value(params, "year")} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-background px-3"><option value="">全部年份</option>{facets.years.map((year) => <option key={year} value={year}>{year} 年</option>)}</select></label>
          <label className="text-sm font-medium">人物<select name="person" defaultValue={personId ?? ""} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-background px-3"><option value="">所有家人</option>{people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>
          <label className="text-sm font-medium">媒体<select name="media" defaultValue={mediaType ?? ""} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-background px-3"><option value="">所有类型</option><option value="image">照片</option><option value="video">视频</option><option value="audio">录音</option></select></label>
          <label className="text-sm font-medium">标签<select name="tag" defaultValue={value(params, "tag")} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-background px-3"><option value="">所有标签</option>{facets.tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-5"><button type="submit" className="ui-button-primary">查看</button>{hasFilters ? <Link href="/timeline" className="ui-button-secondary">清除筛选</Link> : null}</div>
        </form>
      </section>

      {entries.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon="timeline"
            title={hasFilters || cursor ? "没有符合条件的记忆" : "时间轴还在等第一件事"}
            description={hasFilters || cursor ? "换一个月份、人物或媒体类型，也可以回到全部记忆。" : "先记录一句话或一份素材，在收件箱确认后，它就会出现在真实发生的时间位置。"}
            action={hasFilters || cursor ? "回到全部记忆" : "记录第一件事"}
            actionHref={hasFilters || cursor ? "/timeline" : "/capture"}
            secondary={!hasFilters && !cursor ? <Link href="/inbox" className="ui-text-link">查看收件箱</Link> : undefined}
          />
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {[...groups.entries()].map(([month, list]) => (
            <section key={month} aria-label={month}>
              <div className="flex items-center gap-3"><h2 className="text-sm font-semibold tracking-[0.16em] text-muted">{month}</h2><span className="h-px flex-1 bg-line" /></div>
              <ol className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {list.map(({ event, coverAssetId, coverAssetType, coverAssetMime, coverThumbAssetId, assetCount, participantNames }) => (
                  <li key={event.id} className="min-w-0">
                    <MemoryCard id={event.id} title={event.title} dateLabel={dateFormatter.format(event.occurredAt)} ageLabel={child?.birthDate ? formatAgeLabel(child.birthDate, event.occurredAt) : undefined} location={event.locationText} people={participantNames} assetCount={assetCount} milestoneType={event.milestoneType} isPinned={event.isPinned} cover={coverAssetId ? { assetId: coverAssetId, type: coverAssetType, mimeType: coverAssetMime ?? "application/octet-stream", thumbAssetId: coverThumbAssetId } : null} />
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
