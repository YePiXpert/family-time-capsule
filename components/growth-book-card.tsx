"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import album from "@/mobile/assets/illustrations/growing-album.webp";
import { useRouter } from "next/navigation";
import { Icon } from "./ui/icons";
import { growthErrorMessage, type GrowthOverview } from "@/mobile/src/growth/types";
export function GrowthBookCard({ overview }: { overview: GrowthOverview }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function open() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/growth/book", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ month: overview.month }) });
      const body = await response.json();
      if (!response.ok || typeof body.id !== "string") throw new Error(growthErrorMessage(body.error));
      router.push(`/books/${body.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "暂时无法准备成长册。"); setBusy(false); }
  }
  return <section className="growth-book-feature" aria-label="按月成长册">
    <Image src={album} alt="" className="growth-book-art" sizes="(max-width: 639px) 200px, 240px" />
    <div className="page-eyebrow mb-4 flex items-center gap-2"><Icon name="book" size={22} /><span>全家可见 · 随着记录慢慢长大</span></div>
    <h2>{overview.title}</h2>
    <p className="mt-3 text-muted">{overview.pendingBirthday ? "确认宝宝生日，就能把这段日子按月整理成册。" : overview.memoryCount ? `已有 ${overview.memoryCount} 条记录。打开时会收入新增内容，保留你改过的文字、封面和删去的页面。` : "从第一条记录开始，满月前也能预览。"}</p>
    <p className="mt-2 text-sm text-muted">照片、当时写下的话和家人的补充，按真实日期排列。仅收入全家可读、日期明确的记录。</p>
    <div className="mt-5 flex flex-wrap gap-3">
      {overview.pendingBirthday ? <Link href="/family" className="ui-button-primary">确认宝宝生日</Link> : overview.canCreate && overview.memoryCount > 0 ? <button onClick={() => void open()} disabled={busy} className="ui-button-primary">{busy ? "正在准备…" : overview.bookId ? "打开成长册" : "预览成长册"}</button> : overview.bookId ? <Link href={`/books/${overview.bookId}`} className="ui-button-primary">打开成长册</Link> : <Link href="/timeline" className="ui-button-secondary">回看成长记录</Link>}
      {overview.canCreate ? <Link href="/capture" className="ui-button-secondary">记录一刻</Link> : null}
    </div>
    {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
  </section>;
}
