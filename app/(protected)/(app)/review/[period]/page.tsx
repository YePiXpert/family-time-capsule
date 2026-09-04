import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { requireFamily } from "@/lib/family/context";
import { listPeople } from "@/lib/family/service";
import { getReviewOverview } from "@/lib/review/service";
import {
  changeReviewProgressAction,
  editReviewMemoryAction,
  generateReviewStoryAction,
  optimizeReviewStoryAction,
  toggleReviewHighlightAction,
  updateReviewPreferencesAction,
} from "../actions";
import { ReviewQuestionForm } from "./review-question-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "每周回顾 · Family Time Capsule" };

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
const MILESTONES = [
  ["", "不是成长节点"], ["first_time", "第一次"], ["growth", "成长"],
  ["learning", "学会了"], ["family", "家庭时刻"], ["celebration", "庆祝"], ["other", "值得记住"],
] as const;

export default async function ReviewPeriodPage({ params }: PageProps<"/review/[period]">) {
  const context = await requireFamily();
  const { period: periodKey } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(periodKey)) notFound();
  let review: Awaited<ReturnType<typeof getReviewOverview>>;
  try { review = await getReviewOverview(context, periodKey); }
  catch { notFound(); }
  const people = await listPeople(context.familyId);
  const canWriteStory = hasFamilyCapability(context.role, "story:write");
  const canEditEvent = hasFamilyCapability(context.role, "event:write");
  const canManageFamily = hasFamilyCapability(context.role, "family:manage");
  const selected = review.events.filter((event) => event.selected);
  const focus = selected.length ? selected : review.events;
  const missingVoices = focus.filter((event) => event.contributionCount === 0);
  const date = new Intl.DateTimeFormat("zh-CN", { timeZone: review.preferences.timezone, month: "long", day: "numeric" });
  const status = review.period.status === "completed" ? "已完成" : review.period.status === "in_progress" ? "进行中" : "未开始";
  return <main className="page-container max-w-5xl">
    <PageHeader eyebrow="Weekly family rhythm" title="每周回顾" description={`${date.format(review.period.periodStart)}至${date.format(new Date(review.period.periodEnd.getTime() - 1))} · 按 ${review.preferences.timezone} 计算`} actions={<StatusBadge tone={review.period.status === "completed" ? "success" : "neutral"}>{status}</StatusBadge>} />
    {canWriteStory ? <form action={changeReviewProgressAction} className="mt-5 flex flex-wrap gap-3">
      <input type="hidden" name="reviewId" value={review.period.id} /><input type="hidden" name="periodKey" value={review.key} />
      <input type="hidden" name="operation" value={review.period.status === "completed" ? "reopen" : review.period.status === "open" ? "start" : "complete"} />
      <button className="ui-button-primary" type="submit">{review.period.status === "completed" ? "重新打开本周" : review.period.status === "open" ? "开始本周回顾" : "完成本周回顾"}</button>
    </form> : <p className="mt-5 rounded-xl bg-foreground/[0.04] p-4 text-sm text-muted">当前账号只读，可以查看回顾，但不能改变事实、选择重点或生成草稿。</p>}

    <ReviewStep number="1" title="整理本周素材" description="所有新内容仍先经过收件箱人工确认；建议不会自动合并或确认事实。">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="收件箱待整理" value={review.counts.inbox} href="/inbox" />
        <Metric label="待校时" value={review.counts.needsReview} href="/inbox" />
        <Metric label="疑似重复" value={review.counts.duplicateSuggestions} href="/inbox" />
        <Metric label="分簇建议" value={review.counts.clusterSuggestions} href="/inbox" />
        <Metric label="访客新提交" value={review.counts.guestSubmissions} href="/inbox" />
        <Metric label="导入失败项" value={review.counts.failedImports} href="/imports" />
      </div>
    </ReviewStep>

    <ReviewStep number="2" title="选择本周重点" description="只列出已经确认的 MemoryEvent。标题、地点、人物和成长节点都由家人决定。">
      {review.events.length ? <div className="space-y-3">{review.events.map((event) => <article key={event.id} className={`rounded-2xl border p-4 ${event.selected ? "border-accent bg-accent-soft" : "border-line bg-surface"}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><Link href={`/memories/${event.id}`} className="font-medium hover:text-accent">{event.title}</Link><p className="mt-1 text-xs text-muted">{date.format(event.occurredAt)}{event.locationText ? ` · ${event.locationText}` : ""}{event.participantNames.length ? ` · ${event.participantNames.join("、")}` : ""}</p></div>
        {canWriteStory ? <form action={toggleReviewHighlightAction}><input type="hidden" name="reviewId" value={review.period.id} /><input type="hidden" name="eventId" value={event.id} /><input type="hidden" name="periodKey" value={review.key} /><input type="hidden" name="selected" value={event.selected ? "0" : "1"} /><button className={event.selected ? "ui-button-secondary" : "ui-button-primary"} type="submit">{event.selected ? "取消重点" : "选为重点"}</button></form> : null}</div>
        {canEditEvent ? <details className="mt-3"><summary className="cursor-pointer text-sm text-muted">补充真实信息</summary><form action={editReviewMemoryAction} className="mt-3 grid gap-3 sm:grid-cols-2"><input type="hidden" name="eventId" value={event.id} /><input type="hidden" name="periodKey" value={review.key} /><input className="ui-input" name="title" maxLength={100} defaultValue={event.title} aria-label="标题" /><input className="ui-input" name="locationText" maxLength={200} defaultValue={event.locationText ?? ""} placeholder="地点" />
          <select className="ui-input" name="milestoneType" defaultValue={event.milestoneType ?? ""}>{MILESTONES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <fieldset className="rounded-xl border border-line p-3"><legend className="px-1 text-xs text-muted">人物</legend>{people.map((person) => <label key={person.id} className="mr-3 inline-flex items-center gap-1 text-sm"><input type="checkbox" name="participantPersonId" value={person.id} defaultChecked={event.participantNames.includes(person.displayName)} />{person.displayName}</label>)}</fieldset>
          <button className="ui-button-secondary sm:col-span-2" type="submit">保存人工补充</button></form></details> : null}
      </article>)}</div> : <p className="rounded-xl border border-dashed border-line p-5 text-sm text-muted">这一周还没有已确认事件。可以先整理收件箱，也可以把空白的一周标记完成。</p>}
    </ReviewStep>

    <ReviewStep number="3" title="补上家人的声音" description="只提示重点记忆中还没有全家可见讲述的部分；不强迫每条记忆都补充。">
      <div className="grid gap-3 sm:grid-cols-2"><Metric label="等待回答的问题" value={review.counts.pendingRequests} href="/requests" />{missingVoices.map((event) => <div key={event.id} className="rounded-xl border border-line bg-surface p-4"><p className="font-medium">{event.title}</p><p className="mt-1 text-sm text-muted">还没有 family 可见的家人讲述。</p>{canWriteStory ? <ReviewQuestionForm eventTitle={event.title} periodKey={review.key} people={people.map((person) => ({ id: person.id, displayName: person.displayName, relationToChild: person.relationToChild }))} /> : null}</div>)}</div>
    </ReviewStep>

    <ReviewStep number="4" title="生成周记草稿" description="无 AI 也可完整使用；只组装真实事件标题、日期、人物、地点与用户原话，每段保留来源。">
      {review.period.storyId ? <div className="rounded-2xl border border-accent/30 bg-accent-soft p-5"><p className="font-medium">本周期已有一份来源可追溯的故事草稿</p><Link className="ui-button-primary mt-3" href={`/stories/${review.period.storyId}`}>打开周记草稿</Link></div> : review.events.length && canWriteStory ? <form action={generateReviewStoryAction}><input type="hidden" name="reviewId" value={review.period.id} /><input type="hidden" name="periodKey" value={review.key} /><button className="ui-button-primary" type="submit">不用 AI，生成有来源的周记草稿</button></form> : <p className="text-sm text-muted">{review.events.length ? "当前账号不能创建故事。" : "没有已确认事件时不会编造一篇故事。"}</p>}
      {canWriteStory && review.events.length ? <form action={optimizeReviewStoryAction} className="mt-3"><input type="hidden" name="reviewId" value={review.period.id} /><input type="hidden" name="periodKey" value={review.key} /><button className="ui-button-secondary" type="submit">已明确同意时，用 AI 优化草稿表达</button></form> : null}
      <p className="mt-3 text-xs text-muted">仅当文本 AI 已配置且家庭已明确同意时才会入队；AI 只处理有来源的草稿叙述，引文逐字保留，结果仍是草稿，不会自动发布或覆盖人工编辑。</p>
    </ReviewStep>

    {canManageFamily ? <section className="mt-12 rounded-2xl border border-line bg-surface p-5"><h2 className="text-lg font-medium">家庭每周节奏</h2><p className="mt-1 text-sm text-muted">原生 App 根据这些偏好和本机权限安排本地提醒。</p><form action={updateReviewPreferencesAction} className="mt-4 grid gap-3 sm:grid-cols-2"><input type="hidden" name="periodKey" value={review.key} /><label className="text-sm">每周从<select className="ui-input mt-1 w-full" name="weekStartsOn" defaultValue={review.preferences.weekStartsOn}>{WEEKDAYS.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></label><label className="text-sm">提醒日<select className="ui-input mt-1 w-full" name="reminderWeekday" defaultValue={review.preferences.reminderWeekday}>{WEEKDAYS.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></label><label className="text-sm">本地提醒时间<input className="ui-input mt-1 w-full" type="time" name="reminderLocalTime" defaultValue={review.preferences.reminderLocalTime} /></label><fieldset className="space-y-2 rounded-xl border border-line p-3"><legend className="px-1 text-xs text-muted">提醒内容</legend><Check name="remindPendingInbox" label="待整理素材" checked={review.preferences.remindPendingInbox} /><Check name="remindPendingRequests" label="待回答问题" checked={review.preferences.remindPendingRequests} /><Check name="remindUpcomingCapsules" label="即将开启胶囊" checked={review.preferences.remindUpcomingCapsules} /></fieldset><button className="ui-button-secondary sm:col-span-2" type="submit">保存家庭节奏</button></form></section> : null}
  </main>;
}

function ReviewStep({ number, title, description, children }: { number: string; title: string; description: string; children: React.ReactNode }) {
  return <section className="mt-10"><div className="flex gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background">{number}</span><div><h2 className="text-xl font-semibold">{title}</h2><p className="mt-1 text-sm leading-6 text-muted">{description}</p></div></div><div className="mt-4">{children}</div></section>;
}
function Metric({ label, value, href }: { label: string; value: number; href: string }) { return <Link href={href} className="rounded-xl border border-line bg-surface p-4 hover:border-accent/50"><span className="text-2xl font-semibold">{value}</span><span className="ml-2 text-sm text-muted">{label}</span></Link>; }
function Check({ name, label, checked }: { name: string; label: string; checked: boolean }) { return <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={checked} />{label}</label>; }
