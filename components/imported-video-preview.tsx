"use client";
import { useEffect, useState } from "react";

type Conversion = { status: string; kind: string; outputAssetId: string | null };
export function ImportedVideoPreview({ src, assetId }: { src: string; assetId?: string | null }) {
  const [failed, setFailed] = useState(false);
  const [compatible, setCompatible] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!failed || !assetId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    async function load(first: boolean) {
      try {
        const response = await fetch(`/api/media/${encodeURIComponent(assetId!)}/derivations`, {
          method: first ? "POST" : "GET", cache: "no-store",
          headers: { "content-type": "application/json" },
          body: first ? JSON.stringify({ kind: "transcode" }) : undefined,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(response.status === 403 || response.status === 404 ? "当前没有读取原件的权限，请核对账号。" : "暂时无法生成兼容版，可稍后在记忆详情重试。");
        const data = await response.json();
        if (controller.signal.aborted) return;
        const job = (Array.isArray(data.jobs) ? data.jobs : []).find((row: Conversion) => row.kind === "transcode") as Conversion | undefined;
        if (job?.status === "succeeded" && job.outputAssetId) {
          setCompatible(`/api/media/${encodeURIComponent(job.outputAssetId)}`);
          setMessage("已切换到兼容播放版，原件保留。");
        } else if (job && ["failed", "cancelled"].includes(job.status)) {
          setMessage("兼容版生成未完成，可在记忆详情重试。原件保留。");
        } else if (++polls < 120) {
          setMessage("原件已上传，正在准备兼容播放版…");
          timer = setTimeout(() => void load(false), 2000);
        } else setMessage("后台仍在准备兼容播放版，稍后可在记忆详情查看。");
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "暂时无法连接服务器，原件保留。");
      }
    }
    void load(true);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [failed, assetId]);
  return <>
    <video key={compatible ?? src} controls playsInline preload="metadata" src={compatible ?? src} className="max-h-64 w-full rounded-xl bg-black" onError={() => {
      setFailed(true);
      if (compatible) setMessage("当前设备仍无法播放，可在记忆详情下载原件或重试。");
    }} />
    {failed ? <p role="status" className="mt-2 text-sm text-muted">{message || (assetId ? "正在检查兼容播放版…" : "当前设备不能直接播放这个视频。原件已保留，保存并同步后会尝试生成兼容播放版。")}</p> : null}
  </>;
}
