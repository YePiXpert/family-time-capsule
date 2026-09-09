import type { Metadata } from "next";
import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { PageHeader } from "@/components/page-header";
import { BookShelf } from "@/components/book-editor";
import { GrowthBookCard } from "@/components/growth-book-card";
import { getGrowthOverview } from "@/lib/growth/service";
export const metadata: Metadata = { title: "成长册 · 小美成长记" };
export default async function WorksPage({ searchParams }: { searchParams: Promise<{ month?: string; kind?: string }> }) {
  const context = await requireFamily();
  const month = Number((await searchParams).month ?? "1");
  const overview = getGrowthOverview(context, Number.isSafeInteger(month) && month > 0 && month < 1000 ? month : 1);
  return <main className="page-container growth-page">
    <PageHeader title="成长册" description="每天留下一点，慢慢写成送给你的礼物。" />
    {overview.stages.length > 2 ? <nav className="growth-stage-nav mt-5" aria-label="选择成长册月份">{overview.stages.filter(s => s.key !== "birth").map(s => <Link key={s.key} href={`/books?month=${s.key}`} aria-current={String(overview.month) === s.key ? "page" : undefined} className={String(overview.month) === s.key ? "ui-button-primary" : "ui-button-secondary"}>{s.label}</Link>)}</nav> : null}
    <GrowthBookCard key={`${context.userId}:${context.familyId}:${overview.month}`} overview={overview} />
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">我的书架</h2><Link href="/collections" className="ui-text-link">整理素材相册</Link></div>
    <BookShelf key={`${context.userId}:${context.familyId}`} />
  </main>;
}
