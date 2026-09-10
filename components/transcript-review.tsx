"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { OrganizerControl } from "./organizer-control";
import { useRouter } from "next/navigation";
import { ApiError, parseTranscriptReview } from "@/mobile/src/api/client";
import type { TranscriptReview } from "@/mobile/src/transcripts/types";

/** Load authorized full text on demand; ordinary memory HTML stays small. */
export function TranscriptReviewControl(props: { assetId: string; label: string }) {
  return <Control key={props.assetId} {...props} />;
}
function Control({ assetId, label }: { assetId: string; label: string }) {
  const router = useRouter();
  const [review, setReview] = useState<TranscriptReview | null>(null), [draft, setDraft] = useState({ text: "", revision: null as number | null }), [busy, setBusy] = useState(false), [verified, setVerified] = useState(false), [error, setError] = useState<string | null>(null), [success, setSuccess] = useState(false);
  const generation = useRef(0), touched = useRef(false);
  const endpoint = `/api/mobile/v1/transcripts/${encodeURIComponent(assetId)}`;
  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) throw new ApiError("无法读取转录，请检查登录和权限。", response.status);
      const next = parseTranscriptReview(await response.json());
      if (request !== generation.current) return;
      setReview(next); setVerified(true);
      if (!touched.current) setDraft({ text: next.transcript?.text ?? "", revision: next.transcript?.revision ?? null });
    } catch (reason) {
      if (request !== generation.current) return;
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) { setReview(null); setDraft({ text: "", revision: null }); touched.current = false; }
      setError(reason instanceof Error ? reason.message : "无法读取转录。");
    } finally { if (request === generation.current) setBusy(false); }
  }, [endpoint]);
  useEffect(() => { const requests = generation; return () => { requests.current++; }; }, []);
  const save = async () => {
    if (!verified || busy || !review?.canEdit) return;
    const request = ++generation.current;
    setBusy(true); setError(null); setSuccess(false);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: draft.text, revision: draft.revision }) });
      if (request !== generation.current) return;
      if (response.status === 409) {
        setError("转录已在另一端更新。本次没有覆盖，输入已保留，请核对最新版本。");
        await load(); return;
      }
      if (!response.ok) throw new ApiError("转录未保存，请检查登录和权限。", response.status);
      const next = parseTranscriptReview(await response.json());
      if (request !== generation.current) return;
      touched.current = false; setReview(next); setDraft({ text: next.transcript?.text ?? "", revision: next.transcript?.revision ?? null }); setSuccess(true); router.refresh();
    } catch (reason) {
      if (request !== generation.current) return;
      setVerified(false);
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) { setReview(null); setDraft({ text: "", revision: null }); touched.current = false; }
      setError(reason instanceof Error ? reason.message : "转录未保存。");
    } finally { if (request === generation.current) setBusy(false); }
  };
  const stale = review !== null && draft.revision !== (review.transcript?.revision ?? null);
  return <><OrganizerControl kind="asset" id={assetId} reviewNames={false} /><details className="my-3 rounded-xl border border-line p-3 text-sm" onToggle={event => { if (event.currentTarget.open) { setBusy(true); setVerified(false); void load(); } else { generation.current++; } }}>
    <summary className="min-h-11 cursor-pointer py-2">转录全文与修订 · {label}</summary>
    {error ? <p role="alert" className="my-2 text-danger">{error}</p> : null}
    {review ? <div className="grid gap-3">
      <p>{review.transcript?.edited ? "人工修订" : review.transcript ? "AI 转录 · 未确认" : "尚无转录，可手动记录听到的内容。"}</p>
      <p className="whitespace-pre-wrap">{review.transcript?.text || (review.transcript?.edited ? "转录已由你清空" : review.transcript ? "未识别到清晰语音" : "")}</p>
      {review.canEdit ? <>
        <textarea aria-label={`修订 ${label} 的转录`} className="min-h-28 rounded-lg border border-line bg-transparent p-3" maxLength={200_000} value={draft.text} onChange={event => { touched.current = true; setDraft({ ...draft, text: event.target.value }); }} />
        {stale ? <div><p>上方是最新全文，输入仍保留原编辑版本。</p><button type="button" className="ui-button-secondary" onClick={() => { touched.current = false; setDraft({ text: review.transcript?.text ?? "", revision: review.transcript?.revision ?? null }); }}>载入最新转录</button><button type="button" className="ui-button-secondary" onClick={() => setDraft({ ...draft, revision: review.transcript?.revision ?? null })}>已核对，保留我的输入</button></div> : null}
        <button type="button" className="ui-button-primary" disabled={busy || !verified || stale} onClick={() => void save()}>保存修订</button>
        {success ? <p role="status">修订已保存。</p> : null}
      </> : null}
    </div> : <p>展开后读取全文。</p>}
    <button type="button" className="ui-button-secondary my-2" disabled={busy} onClick={() => { setError(null); setBusy(true); setVerified(false); void load(); }}>刷新转录</button>
  </details></>;
}
