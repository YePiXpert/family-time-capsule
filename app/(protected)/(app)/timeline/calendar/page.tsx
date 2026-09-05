import Link from "next/link";
import Image from "next/image";
import { requireFamily } from "@/lib/family/context";
import { listPeople } from "@/lib/family/service";
import { getBrowsePage, getCalendarMonth } from "@/lib/memories/calendar";
import {
  addCalendarMonths,
  ageLocations,
  calendarDate,
  parseCalendarDate,
} from "@/mobile/src/utils/calendar";
import { PageHeader } from "@/components/page-header";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireFamily();
  const params = await searchParams;
  const value = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : "";
  const month =
    value("month") ||
    calendarDate(new Date(), context.familyTimezone).slice(0, 7);
  const date = value("date");
  if (date && !date.startsWith(`${month}-`)) notFound();
  const filters = {
    person: value("person"),
    media: value("media"),
    tag: value("tag"),
  };
  let calendar, page;
  try {
    calendar = await getCalendarMonth(context, month, filters);
    page = await getBrowsePage(
      context,
      date || month,
      filters,
      value("cursor"),
    );
  } catch {
    notFound();
  }
  const people = await listPeople(context.familyId);
  const child = people.find((p) => p.isChild && p.birthDate);
  const href = (patch: Record<string, string>) => {
    const next = new URLSearchParams({
      month,
      ...filters,
      ...(date ? { date } : {}),
    });
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    return `/timeline/calendar?${next}`;
  };
  const currentUrl = href({
    ...(value("cursor") ? { cursor: value("cursor") } : {}),
  });
  return (
    <main className="page-container">
      <PageHeader
        eyebrow="Family calendar"
        title="记忆日历"
        description={`按家庭时区 ${context.familyTimezone}，回到事情发生的那一天。`}
      />
      <nav aria-label="时间轴浏览方式" className="mt-4 flex gap-3">
        <Link
          className="ui-button-secondary"
          href={`/timeline?${new URLSearchParams(filters)}`}
        >
          时间线
        </Link>
        <Link
          className="ui-button-primary"
          aria-current="page"
          href={currentUrl}
        >
          日历
        </Link>
        <Link className="ui-button-secondary" href="/collections">相册</Link>
      </nav>
      <form
        className="mt-6 grid gap-3 sm:grid-cols-3"
        action="/timeline/calendar"
      >
        <label>
          年 / 月
          <input
            aria-label="年 / 月"
            className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3"
            type="month"
            name="month"
            defaultValue={month}
            required
          />
        </label>
        <label>
          人物
          <select
            className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3"
            name="person"
            defaultValue={filters.person}
          >
            <option value="">所有家人</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          媒体
          <select
            className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3"
            name="media"
            defaultValue={filters.media}
          >
            <option value="">所有类型</option>
            {[
              ["image", "照片"],
              ["video", "视频"],
              ["audio", "录音"],
              ["document", "文档"],
            ].map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          标签
          <input
            className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3"
            name="tag"
            defaultValue={filters.tag}
            maxLength={50}
          />
        </label>
        <button className="ui-button-primary self-end" type="submit">
          查看月份
        </button>
      </form>
      {child?.birthDate ? (
        <nav aria-label="按年龄定位" className="mt-4 flex flex-wrap gap-2">
          {ageLocations(child.birthDate).map((item) => (
            <Link
              className="ui-button-secondary"
              key={item.label}
              href={href({ month: item.date.slice(0, 7), date: item.date })}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}
      <section
        aria-label={`${month} 记忆日历`}
        className="mt-6 rounded-2xl border border-line bg-surface p-2 sm:p-4"
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <Link
            aria-label="上个月"
            className="ui-button-secondary"
            href={href({
              month: addCalendarMonths(`${month}-01`, -1).slice(0, 7),
              date: "",
            })}
          >
            上月
          </Link>
          <h2>{month}</h2>
          <Link
            aria-label="下个月"
            className="ui-button-secondary"
            href={href({
              month: addCalendarMonths(`${month}-01`, 1).slice(0, 7),
              date: "",
            })}
          >
            下月
          </Link>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
            <div key={day} className="py-2 text-center text-sm text-muted">
              {day}
            </div>
          ))}
          {Array.from(
            { length: parseCalendarDate(`${month}-01`).getUTCDay() },
            (_, i) => (
              <span key={`blank-${i}`} />
            ),
          )}
          {calendar.days.map((day) => (
            <Link
              aria-label={`${day.date}，${day.count} 条记忆`}
              aria-current={date === day.date ? "date" : undefined}
              key={day.date}
              href={href({ date: day.date })}
              className={`min-h-20 min-w-0 rounded-lg border p-1 text-center sm:p-2 ${date === day.date ? "border-accent bg-background" : "border-line"}`}
            >
              <span className="block text-sm">
                {Number(day.date.slice(-2))}
              </span>
              <span className="block text-xs text-muted">
                {day.count ? `${day.count} 条` : "—"}
              </span>
              {day.covers[0] ? (
                <span className="mt-1 block overflow-hidden rounded">
                  <Image
                    unoptimized
                    width={180}
                    height={120}
                    loading="lazy"
                    className="h-8 w-full object-cover sm:h-14"
                    src={`/api/media/${day.covers[0].assetId}`}
                    alt="当天记忆封面"
                  />
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      </section>
      <section className="mt-6" aria-label="所选日期的记忆">
        <h2 className="text-xl">{date || month} · 记忆</h2>
        {page.entries.length ? (
          <ol className="mt-4 grid gap-3 sm:grid-cols-2">
            {page.entries.map((entry) => (
              <li id={`memory-${entry.id}`} key={entry.id}>
                <Link
                  className="block break-words rounded-xl border border-line bg-surface p-4"
                  href={`/memories/${entry.id}?returnTo=${encodeURIComponent(`${currentUrl}#memory-${entry.id}`)}`}
                >
                  <h3>{entry.title}</h3>
                  <p className="text-sm text-muted">{entry.date}</p>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-muted">这个日期没有符合筛选的已确认记忆。</p>
        )}
        {page.nextCursor ? (
          <Link
            className="ui-button-secondary mt-4"
            href={href({ cursor: page.nextCursor })}
          >
            更早的记忆
          </Link>
        ) : null}
      </section>
    </main>
  );
}
