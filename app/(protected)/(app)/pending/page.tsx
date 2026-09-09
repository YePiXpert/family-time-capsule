import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { getHomeDashboard } from "@/lib/home/service";
import { PageHeader } from "@/components/page-header";

export default async function PendingPage() {
  const data = await getHomeDashboard(await requireFamily());
  return <main className="page-container">
    <PageHeader title="待处理" backHref="/timeline" backLabel="返回记忆" />
    <div className="mt-5 space-y-3">
      {data.inbox.count > 0 ? <Link href="/inbox" className="ui-button-secondary">待确认内容 · {data.inbox.count} 条</Link> : null}
      {data.pendingImports.map(item => <Link key={item.id} href={`/imports/${item.id}`} className="block rounded-xl border border-line p-4">{item.title} · 继续导入</Link>)}
      {!data.inbox.count && !data.pendingImports.length ? <p className="text-muted">都处理好了。</p> : null}
    </div>
  </main>;
}
