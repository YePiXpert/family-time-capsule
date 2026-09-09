import type { Metadata } from "next";
import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { PageHeader } from "@/components/page-header";
import { BookShelf } from "@/components/book-editor";
import { CollectionsClient } from "../collections/ui";
export const metadata: Metadata = { title: "作品 · Family Time Capsule" };
export default async function WorksPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  await requireFamily();
  const books = (await searchParams).kind === "book";
  return <main className="page-container">
    <PageHeader title="作品" />
    <nav aria-label="作品类型" className="mt-4 flex gap-3">
      <Link href="/books" aria-current={!books ? "page" : undefined} className={!books ? "ui-button-primary" : "ui-button-secondary"}>相册</Link>
      <Link href="/books?kind=book" aria-current={books ? "page" : undefined} className={books ? "ui-button-primary" : "ui-button-secondary"}>家庭书</Link>
    </nav>
    {books ? <BookShelf /> : <CollectionsClient embedded />}
  </main>;
}
