"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listBrowserDrafts, type BrowserDraft } from "@/lib/drafts/browser-store";
import type { Draft } from "@/lib/drafts/model";

/** Recovery lives with pending work, outside the quick composer. */
export function PendingDrafts({ scope, otherwiseEmpty = false }: { scope: string; otherwiseEmpty?: boolean }) {
  const [state, setState] = useState<{ scope: string; local: BrowserDraft[]; remote: Draft[] }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void listBrowserDrafts(scope).then(async local => {
      if (!active) return;
      const visible = local.filter(d => ["editing", "queued"].includes(d.status) && (d.content.text || d.content.title || d.content.items.length));
      setState({ scope, local: visible, remote: [] });
      setError("");
      const remote = await fetch("/api/mobile/v1/drafts", { signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.json() : null).catch(() => null);
      if (active) setState({ scope, local: visible, remote: (remote?.drafts ?? []).filter((d: Draft) => d.status === "editing" && !local.some(row => row.id === d.id)) });
    }).catch(() => { if (active) setError("暂时无法读取本机记录，请重新打开此页。"); });
    return () => { active = false; };
  }, [scope]);
  if (error) return <p role="alert">{error}</p>;
  if (state?.scope !== scope) return <p role="status" className="text-muted">正在读取未完成记录…</p>;
  if (!state.local.length && !state.remote.length) return otherwiseEmpty ? <p className="text-muted">都处理好了。</p> : null;
  return <section aria-label="未完成记录" className="space-y-3">
    <h2>未完成记录</h2>
    {state.local.map(d => <Link key={d.id} href={`/capture?localDraft=${encodeURIComponent(d.id)}`} className="block rounded-xl border border-line p-4">{d.content.title || d.content.text.slice(0, 40) || "照片与声音"} · {d.status === "queued" ? "待同步" : "继续记录"}</Link>)}
    {state.remote.map(d => <Link key={d.id} href={`/capture?draft=${encodeURIComponent(d.id)}`} className="block rounded-xl border border-line p-4">{d.title || d.text.slice(0, 40) || "照片与声音"} · 继续记录</Link>)}
  </section>;
}
