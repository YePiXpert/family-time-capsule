"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NameReviewControl } from "./name-review";
import { parseOrganizerReview } from "@/mobile/src/api/client";
import { aiJobFailureMessage } from "@/lib/ai/job-messages";
import type { OrganizerTarget, OrganizerReview, OrganizerOperation } from "@/mobile/src/ai/organizer-types";

export function OrganizerControl(props: OrganizerTarget & { reviewNames?: boolean; assetOperation?: "name" | "transcribe"; defaultOpen?: boolean }) {
  return <Control key={JSON.stringify([props.kind, props.id])} {...props} />;
}
function Control({ kind, id, reviewNames = true, assetOperation = "transcribe", defaultOpen = false }: OrganizerTarget & { reviewNames?: boolean; assetOperation?: "name" | "transcribe"; defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen), [review, setReview] = useState<OrganizerReview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [refreshVersion, setRefreshVersion] = useState(0);
  const generation = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null), previous = useRef("");
  const receive = useCallback((next: OrganizerReview) => {
    const signature = JSON.stringify([next.names, next.transcripts]);
    if (previous.current && previous.current !== signature) { setRefreshVersion(value => value + 1); router.refresh(); }
    previous.current = signature; setReview(next);
  }, [router]);
  const load = useCallback(async function load() {
    const request = ++generation.current;
    if (timer.current) clearTimeout(timer.current);
    try {
      const response = await fetch(`/api/mobile/v1/ai/organizer?${new URLSearchParams({ kind, id })}`, { cache: "no-store" });
      if (request !== generation.current) return;
      if (!response.ok) { if ([401, 403, 404].includes(response.status)) setReview(null); throw new Error(response.status === 404 ? "当前服务器或素材暂不支持此操作，请刷新核对。" : "无法读取整理状态，请检查登录和权限。"); }
      const next = parseOrganizerReview(await response.json());
      if (request !== generation.current) return;
      receive(next); setError(null);
      if (next.tasks.some(task => task.active)) timer.current = setTimeout(() => void load(), 3000);
    } catch (reason) { if (request === generation.current) setError(reason instanceof Error ? reason.message : "无法读取整理状态。"); }
  }, [kind, id, receive]);
  useEffect(() => { const requests = generation; if (open) void load(); return () => { requests.current++; if (timer.current) clearTimeout(timer.current); }; }, [open, load]);
  const mutate = async (operation: OrganizerOperation, jobId?: string) => {
    if (busy) return;
    const request = ++generation.current;
    if (timer.current) clearTimeout(timer.current);
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/mobile/v1/ai/organizer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, id, operation, jobId }) });
      const value = await response.json();
      if (request !== generation.current) return;
      if (!response.ok) { if ([401, 403, 404].includes(response.status)) setReview(null); throw new Error(aiJobFailureMessage(value.error)); }
      receive(parseOrganizerReview(value));
      timer.current = setTimeout(() => void load(), 1500);
    } catch (reason) { if (request === generation.current) setError(reason instanceof Error ? reason.message : "整理请求未完成。"); }
    finally { if (request === generation.current) setBusy(false); }
  };
  const transcription = kind === "asset" && assetOperation === "transcribe";
  const capability = review?.settings.capabilities.find(row => row.capability === (transcription ? "transcription" : "text"));
  const active = review?.tasks.some(task => task.active);
  return <div className="my-3">
    <details open={open} className="rounded-xl border border-line p-3 text-sm" onToggle={event => { setOpen(event.currentTarget.open); if (event.currentTarget.open) setBusy(false); }}>
      <summary className="min-h-11 cursor-pointer py-2">{transcription ? "转成文字" : defaultOpen ? "整理进度与建议" : "AI 帮我起名"}</summary>
      <p className="my-2 text-muted">仅处理你选择的素材，原件可随时查看。标题、人物、时间和合并均由你确认。</p>
      {error ? <p role="alert" className="my-2 text-red-700 dark:text-red-300">{error}</p> : null}
      {review ? <>
        <p className="my-2">{!review.settings.configured ? "AI 未配置" : !capability?.available ? "所需模型未配置" : !capability.consented ? "等待管理员同意外部处理" : `${review.settings.provider} · ${capability.model}`}</p>
        {review.settings.configured && !review.settings.workerAvailable ? <p>后台暂不可用，任务会保留等待；记录与播放仍可使用。</p> : null}
        <Link href="/settings/ai" className="underline">查看 AI 设置、检测与授权</Link>
        <button type="button" className="ui-button-primary my-2" disabled={busy || active || !capability?.available || !capability.consented} onClick={() => void mutate(transcription ? "transcribe" : "name")}>{transcription ? "开始转成文字" : "生成标题建议"}</button>
        {(defaultOpen ? review.tasks.slice(0, 1) : review.tasks).map((task, index) => <div key={task.id} className="my-2 rounded-lg border border-line p-3">
          <p role="status">{task.message}</p>
          <ol className="my-2 list-inside list-decimal text-muted">{task.steps.map((step, i) => <li key={i}>{step.label} · {({ pending: "等待中", running: "处理中", completed: "完成", failed: "失败", cancelled: "已取消" })[step.status]}</li>)}</ol>
          <div className="flex flex-wrap gap-2">
            {task.canCancel ? <button type="button" className="ui-button-secondary" disabled={busy} onClick={() => void mutate("cancel", task.id)}>取消任务</button> : null}
            {task.canRetry && index === 0 ? <button type="button" className="ui-button-secondary" disabled={busy || active} onClick={() => void mutate("retry", task.id)}>重试失败步骤</button> : null}
            {task.canRegenerate && index === 0 ? <button type="button" className="ui-button-secondary" disabled={busy || active} onClick={() => void mutate("regenerate", task.id)}>重新生成建议（可能计费）</button> : null}
          </div>
        </div>)}
        {!reviewNames && review.names?.suggestions.filter(row => row.status === "pending" && row.valid).map(row => <p key={row.id}>AI 建议：{row.title}，请在下方审核后采用。</p>)}
        {defaultOpen && review.transcripts.length > 0 && <details><summary className="min-h-11 cursor-pointer py-2">查看录音文字</summary>{review.transcripts.map(row => <p key={row.assetId} className="my-2 whitespace-pre-wrap">{row.text}</p>)}</details>}
      </> : <p>展开后读取服务状态。</p>}
      <button type="button" className="ui-button-secondary my-2" disabled={busy} onClick={() => void load()}>刷新整理状态</button>
    </details>
    {reviewNames ? <NameReviewControl kind={kind} id={id} refreshVersion={refreshVersion} defaultOpen={defaultOpen} /> : null}
    {defaultOpen && kind === "memory_event" && <Link className="underline" href={`/memories/${id}?mode=archive#ai-suggestions`}>查看地点、时间与标签建议</Link>}
  </div>;
}
