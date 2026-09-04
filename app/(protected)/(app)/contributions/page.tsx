import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { StatusBadge } from "@/components/status-badge";
import { requireFamilyCapability } from "@/lib/authz/context";
import { listContributionPortals, listPortalSubmissionBundles } from "@/lib/contribution-portals/service";
import { listPeople } from "@/lib/family/service";
import { PortalControls, PortalCreateForm } from "./portal-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "家庭投递箱 · Family Time Capsule" };

export default async function ContributionPortalsPage() {
  const context = await requireFamilyCapability("contribution:create");
  const [portals, people] = await Promise.all([
    Promise.resolve(listContributionPortals(context)),
    listPeople(context.familyId),
  ]);
  const submissions = listPortalSubmissionBundles(context);
  return (
    <main className="page-container max-w-5xl">
      <PageHeader eyebrow="Family contribution portal" title="家庭投递箱" description="发一个受限链接，请家人无需账号提交照片、声音、视频、文档和文字。每份内容始终先进入收件箱。" />
      <section className="mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <SectionHeader title="创建投递箱" description="原始 token 只显示一次；二维码在本机生成，不调用外部服务。" />
        <div className="mt-4"><PortalCreateForm people={people.map((entry) => ({ id: entry.id, displayName: entry.displayName }))} /></div>
      </section>
      <section className="mt-10">
        <SectionHeader title="已有投递箱" description={`${portals.length} 个配置；暂停、撤销或换链接都会立即生效。`} />
        <div className="mt-4 grid gap-4">
          {portals.map((portal) => (
            <article key={portal.id} className="rounded-2xl border border-line bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="font-medium">{portal.title}</h2><p className="mt-1 text-sm text-muted">{portal.description}</p></div>
                <StatusBadge tone={portal.status === "open" ? "success" : "neutral"}>{portal.status === "open" ? "开放中" : portal.status === "paused" ? "已暂停" : "已撤销"}</StatusBadge>
              </div>
              <p className="mt-3 text-xs text-muted">已提交 {portal.submissionCount}/{portal.maxSubmissions} 次 · {portal.pendingCount} 个批次仍在接收 · 每次最多 {portal.maxFilesPerSubmission} 份 · 有效期至 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(portal.expiresAt)}</p>
              {submissions.some((entry) => entry.portalId === portal.id) ? (
                <ul className="mt-3 space-y-1 text-xs text-muted" aria-label="最近投递批次">
                  {submissions.filter((entry) => entry.portalId === portal.id).slice(0, 3).map((entry) => (
                    <li key={entry.id}>
                      {entry.guestDisplayName ? `${entry.guestDisplayName}（访客填写，未经确认）` : "匿名访客"}
                      {" · "}{entry.status === "completed" ? "已进入收件箱" : "仍在接收"}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3"><Link href="/inbox" className="ui-button-primary">打开收件箱</Link></div>
              <PortalControls portalId={portal.id} status={portal.status} />
            </article>
          ))}
          {portals.length === 0 ? <p className="rounded-xl border border-dashed border-line p-5 text-sm text-muted">还没有投递箱。可以从“旧照片征集”或“请大家留下今天的声音”开始。</p> : null}
        </div>
      </section>
    </main>
  );
}
