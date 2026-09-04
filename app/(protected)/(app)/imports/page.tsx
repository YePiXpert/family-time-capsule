import type { Metadata } from "next";
import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { listPeople } from "@/lib/family/service";
import { listImportSessions } from "@/lib/imports/service";
import { PageHeader } from "@/components/page-header";
import { BatchImportCenter } from "./batch-import-center";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "批量导入 · Family Time Capsule" };

export default async function ImportsPage() {
  const { familyId } = await requireFamily();
  const [people, history] = await Promise.all([
    listPeople(familyId),
    listImportSessions(familyId, { limit: 20 }),
  ]);
  return <main className="page-container max-w-5xl">
    <PageHeader eyebrow="Persistent imports" title="批量导入中心" description="一次选择很多文件，最多三项并发；页面关闭、网络中断或服务器重启后都能按确认 offset 继续。" />
    <BatchImportCenter people={people.map((person) => ({ id: person.id, displayName: person.displayName, isChild: person.isChild }))} />
    {history.sessions.length > 0 ? <section className="mt-12">
      <h2 className="text-lg font-semibold">最近批次</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {history.sessions.map((session) => <li key={session.id}><Link href={`/imports/${session.id}`} className="block rounded-xl border border-line bg-surface p-4 hover:border-accent/50">
          <div className="flex justify-between gap-3"><span className="font-medium">{session.defaultTitle || "未命名导入"}</span><span className="text-xs text-muted">{session.status}</span></div>
          <p className="mt-2 text-sm text-muted">完成 {session.completedCount}/{session.totalCount} · 失败 {session.failedCount}</p>
        </Link></li>)}
      </ul>
    </section> : null}
  </main>;
}
