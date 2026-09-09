"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function MilestoneActions({ id, revision, milestone }: { id: string; revision: number; milestone: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function mark(value: string) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/mobile/v1/memories/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: revision, mutationId: crypto.randomUUID(), milestoneType: milestone === value ? null : value }) });
      if (!response.ok) throw new Error(response.status === 409 ? "这条记录刚被修改，请刷新后再试。" : "暂时无法保存标记，请重试。");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "暂时无法保存标记。"); }
    finally { setBusy(false); }
  }
  return <section className="my-4" aria-label="标记重要时刻">
    <div className="flex flex-wrap items-center gap-2"><span className="mr-2 text-sm text-muted">标记这一刻</span>{[["first_time", "第一次"], ["other", "值得记住"]].map(([value, label]) => <button key={value} disabled={busy} aria-pressed={milestone === value} className={milestone === value ? "ui-button-primary" : "ui-button-secondary"} onClick={() => void mark(value!)}>{label}</button>)}</div>
    {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
  </section>;
}
