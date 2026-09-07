"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Draft } from "@/lib/drafts/model";
const button = "ui-button-secondary min-h-11";
const errors: Record<string, string> = { revision_conflict: "草稿或收件已被修改，请刷新后核对。", intake_pending: "还有原件未传完，请先完成上传或取消失败项。", intake_too_large: "这批内容超过一份草稿的容量，请先仅存资料库，再选择素材组成记忆。", forbidden: "当前账号没有整理权限。", not_found: "找不到属于当前账号的收件或草稿。", asset_unavailable: "有原件已删除或不再有权限，请刷新核对。" };
export function IntakeDestination({ id, revision, destination, draftId, drafts, text, assets }: { id: string; revision: number; destination: string; draftId: string | null; drafts: Draft[]; text: string[]; assets: { id: string; title: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function choose(destination: "draft" | "library", target?: Draft) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/imports/${id}/destination`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ destination, revision, draftId: target?.id ?? crypto.randomUUID(), draftRevision: target?.revision ?? 0, mutationId: crypto.randomUUID() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(errors[result.error] ?? "操作未完成。已收到的原件仍在，请重试。");
      if (result.draftId) router.push(`/capture?draft=${encodeURIComponent(result.draftId)}`);
      else router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "无法连接服务器，请稍后继续。"); }
    finally { setBusy(false); }
  }
  return <section aria-label="收到的内容与去向" className="my-6 space-y-4 rounded-2xl border border-line bg-surface p-5">
    <h2 className="text-xl">收到的内容</h2>
    <p>已保全的原件现在就能打开。先留在这里，明天再整理也可以。保存到资料库不会自动创建记忆。</p>
    {text.map((value, index) => <p className="whitespace-pre-wrap break-words" key={index}>{value}</p>)}
    <div className="flex flex-wrap gap-3">{assets.map(asset => <Link className={button} key={asset.id} href={`/library/${asset.id}`}>打开：{asset.title}</Link>)}</div>
    {destination === "pending" ? <div className="flex flex-wrap gap-3">
      <button className={button} disabled={busy} onClick={() => void choose("draft")}>加入新草稿</button>
      {drafts.map(draft => <button key={draft.id} className={button} disabled={busy} onClick={() => void choose("draft", draft)}>加入草稿：{draft.title || draft.text.slice(0, 30) || "未命名的一件事"}</button>)}
      <button className={button} disabled={busy} onClick={() => void choose("library")}>仅存资料库</button>
    </div> : draftId ? <Link className={button} href={`/capture?draft=${encodeURIComponent(draftId)}`}>继续这件事</Link> : <p>已选择仅存资料库。附带文字保留在本页，原件可以稍后加入记忆。</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
