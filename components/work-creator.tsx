"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Material = { id: string; kind: "memory" | "collection"; title: string };
export function WorkCreator({ kind, onCancel }: { kind: "album" | "book"; onCancel: () => void }) {
  const router = useRouter();
  const [source, setSource] = useState<"memory" | "collection">("memory");
  const [month, setMonth] = useState("");
  const [entries, setEntries] = useState<Material[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Material[]>([]);
  const [audience, setAudience] = useState("family");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  async function load(after = "", mine = generation.current) {
    setLoading(true);
    try {
      const response = await fetch(`/api/books/projects/materials?${new URLSearchParams({ kind: source, audience: kind === "album" ? "personal" : audience, month, cursor: after })}`);
      if (!response.ok) throw new Error("无法读取素材，请重试。");
      const page = await response.json();
      if (mine !== generation.current) return;
      setEntries(old => after ? [...old, ...page.entries] : page.entries);
      setCursor(page.nextCursor); setError("");
    } catch (e) { if (mine === generation.current) setError((e as Error).message); }
    finally { if (mine === generation.current) setLoading(false); }
  }
  useEffect(() => {
    const requests = generation;
    const mine = ++requests.current;
    const timer = setTimeout(() => void load("", mine), 0);
    return () => { clearTimeout(timer); requests.current++; };
    // The request generation prevents late pages from a prior filter replacing current material.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, month, audience, kind]);
  async function create() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/works", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, audience, selection: selected.map(({ id, kind }) => ({ id, kind })) }) });
      if (!response.ok) throw new Error("生成失败，选择仍保留。请确认素材可读后重试。");
      const result = await response.json();
      router.push(`/${kind === "book" ? "books" : "collections"}/${result.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  const field = "min-h-11 rounded-xl border border-line bg-surface px-3 py-2";
  return <section aria-label="新建作品" className="my-4 space-y-4 rounded-2xl border border-line p-4">
    <h2 className="text-xl">选出想留下的记忆</h2>
    <fieldset disabled={busy} className="space-y-4">
      <details><summary className="min-h-11 cursor-pointer py-2">筛选与读者</summary><div className="flex flex-wrap gap-3">
        {kind === "book" && <label>素材来源 <select className={field} value={source} onChange={e => { setSource(e.target.value as typeof source); setEntries([]); setCursor(null); }}><option value="memory">记忆</option><option value="collection">相册</option></select></label>}
        {source === "memory" && <label>月份 <input className={field} type="month" value={month} onChange={e => { setMonth(e.target.value); setEntries([]); setCursor(null); }} /></label>}
        {kind === "book" && <label>读者 <select className={field} value={audience} onChange={e => { setAudience(e.target.value); setSelected([]); setEntries([]); setCursor(null); }}><option value="family">全家可见</option><option value="personal">仅自己</option></select></label>}
      </div></details>
      <p className="text-sm text-muted">{kind === "album" ? "按原记忆权限显示" : audience === "family" ? "全家可见" : "仅自己"} · 已选 {selected.length} 条，标题和封面自动生成，之后都能修改。</p>
      {error && <p role="alert">{error}<button type="button" className="ui-text-link ml-3" onClick={() => void load()}>重新读取</button></p>}
      <div className="grid max-h-96 gap-2 overflow-auto sm:grid-cols-2">{entries.map(item => {
        const checked = selected.some(s => s.id === item.id && s.kind === item.kind);
        return <label key={`${item.kind}:${item.id}`} className="flex min-h-12 items-center gap-3 rounded-xl border border-line p-3"><input type="checkbox" checked={checked} disabled={!checked && selected.length >= 100} onChange={() => setSelected(old => checked ? old.filter(s => s.id !== item.id || s.kind !== item.kind) : [...old, item])} />{item.title}</label>;
      })}</div>
      {!loading && !entries.length && !error && <p>还没有可选记忆，先记录一刻或调整筛选。</p>}
      {loading && <p role="status">正在读取…</p>}
      {cursor && <button type="button" className="ui-button-secondary" disabled={loading} onClick={() => void load(cursor)}>更多素材</button>}
      <div className="flex gap-3"><button className="ui-button-primary" disabled={!selected.length || busy} onClick={() => void create()}>{busy ? "正在生成…" : "生成预览"}</button><button className="ui-button-secondary" onClick={onCancel}>取消</button></div>
    </fieldset>
  </section>;
}
