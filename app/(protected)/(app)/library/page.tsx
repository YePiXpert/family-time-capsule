import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { listLibraryAssets } from "@/lib/assets/library";
import { PageHeader } from "@/components/page-header";
import { LibraryClient } from "./ui";
export const dynamic = "force-dynamic";
export const metadata = { title: "资料库 · Family Time Capsule" };
export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const context = await requireFamily();
  const query = await searchParams;
  const type = ["image", "audio", "video", "document"].includes(query.type ?? "") ? query.type! : "";
  const initial = listLibraryAssets(context, { type });
  return <main className="page-container"><PageHeader title="资料库" description="家里保留下来的照片、视频、录音和文档。" actions={initial.canCapture ? <Link href="/imports" className="ui-button-secondary">批量导入</Link> : undefined} /><nav className="my-4 flex flex-wrap gap-3" aria-label="记忆浏览方式"><Link className="ui-button-secondary" href="/timeline">时间线</Link><Link className="ui-button-primary" href="/library" aria-current="page">资料</Link><Link className="ui-button-secondary" href="/timeline/calendar">日历</Link><Link className="ui-button-secondary" href="/collections">相册</Link><Link className="ui-button-secondary" href="/search">搜索</Link></nav><LibraryClient key={`${context.userId}:${context.familyId}:${type}`} initial={initial} timezone={context.familyTimezone} type={type} /></main>;
}
