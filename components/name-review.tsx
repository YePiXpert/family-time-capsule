"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NAME_SOURCE_LABELS, type NameKind, type NameReview } from "@/mobile/src/names/types";

export function NameReviewControl({ kind, id, refreshVersion = 0, defaultOpen = false }: { kind: NameKind; id: string; refreshVersion?: number; defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [review, setReview] = useState<NameReview | null>(null);
  const [title, setTitle] = useState("");
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const touched = useRef(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    const requests = generation;
    const request = ++requests.current;
    void fetch(`/api/mobile/v1/names?${new URLSearchParams({ kind, id })}`, { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("暂时无法读取名称，请检查登录与权限。");
      const value = await response.json() as NameReview;
      if (request !== generation.current) return;
      setReview(value); if (!touched.current) setTitle(value.target.text ?? ""); setError(null);
    }).catch(reason => { if (request === generation.current) setError(reason.message); });
    return () => { requests.current++; };
  }, [kind, id, open, refresh, refreshVersion]);

  const mutate = async (input: Record<string, unknown>) => {
    if (!review || busy) return;
    const request = ++generation.current;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/mobile/v1/names", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, id, revision: review.target.revision, ...input }) });
      if (!response.ok) throw new Error(response.status === 409 ? "名称或建议已变化，本次没有覆盖。你的输入已保留；请刷新核对最新版本。" : response.status === 403 ? "权限或可见范围不允许这次修改。" : "本次修改未完成，请稍后重试。");
      const next = await response.json() as NameReview;
      if (request !== generation.current) return;
      setReview(next); touched.current = false; setTitle(next.target.text ?? ""); setEdited({}); router.refresh();
    } catch (reason) { if (request === generation.current) setError(reason instanceof Error ? reason.message : "保存失败。"); }
    finally { if (request === generation.current) setBusy(false); }
  };

  return <details open={open} className="my-3 rounded-xl border border-line p-3 text-sm" onToggle={event => { setOpen(event.currentTarget.open); if (event.currentTarget.open) setBusy(false); }}>
    <summary className="min-h-11 cursor-pointer py-2">{kind === "asset" ? "修改素材展示名" : "修改标题与审核 AI 建议"}</summary>
    {error ? <p role="alert" className="my-2 text-red-700 dark:text-red-300">{error}</p> : null}
    <button type="button" className="ui-button-secondary my-2" disabled={busy} onClick={() => setRefresh(value => value + 1)}>刷新名称与建议（保留输入）</button>
    {review ? <div className="grid gap-3">
      <p className="text-muted">{NAME_SOURCE_LABELS[review.target.source] ?? "名称"} · 修改展示名称会保留原文件名与原件。</p>
      <label>人工{kind === "asset" ? "展示名" : "标题"}<input className="mt-1 min-h-11 w-full rounded-lg border border-line bg-transparent px-3" maxLength={100} value={title} onChange={event => { touched.current = true; setTitle(event.target.value); }} /></label>
      <button className="ui-button-secondary" type="button" disabled={busy || !title.trim()} onClick={() => void mutate({ operation: "rename", title })}>保存人工名称</button>
      {review.suggestions.filter(suggestion => suggestion.status === "pending" || suggestion.canUndo).map(suggestion => <div key={suggestion.id} className="grid gap-2 rounded-lg border border-line p-3">
        <p>AI 建议：{suggestion.title}{suggestion.status === "pending" && !suggestion.valid ? "（已过期，请重新生成）" : ""}</p>
        {suggestion.status === "pending" ? <>
          <input aria-label="修改建议标题" className="min-h-11 rounded-lg border border-line bg-transparent px-3" maxLength={100} value={edited[suggestion.id] ?? suggestion.title} onChange={event => setEdited({ ...edited, [suggestion.id]: event.target.value })} />
          <div className="flex flex-wrap gap-2"><button type="button" className="ui-button-primary" disabled={busy || !suggestion.valid} onClick={() => void mutate({ operation: "accept", suggestionId: suggestion.id, suggestionRevision: suggestion.revision, ...(edited[suggestion.id] === undefined ? {} : { editedTitle: edited[suggestion.id] }) })}>{edited[suggestion.id] === undefined ? "采用" : "修改后采用"}</button>
          <button type="button" className="ui-button-secondary" disabled={busy} onClick={() => void mutate({ operation: "reject", suggestionId: suggestion.id, suggestionRevision: suggestion.revision })}>忽略</button></div>
        </> : <button type="button" className="ui-button-secondary" disabled={busy} onClick={() => void mutate({ operation: "undo", suggestionId: suggestion.id, suggestionRevision: suggestion.revision })}>撤销这次采用</button>}
      </div>)}
    </div> : <p className="text-muted">正在读取…</p>}
  </details>;
}
