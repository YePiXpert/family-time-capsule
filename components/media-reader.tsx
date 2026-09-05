"use client";
import { useEffect, useRef, useState } from "react";
import { MediaBlock, MediaImage } from "./media-view";
import type {
  ReaderAsset,
  ReaderTranscript,
  MediaDerivation,
} from "@/mobile/src/media/types";
export function MediaReader({ assets }: { assets: ReaderAsset[] }) {
  const [active, setActive] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const [continuous, setContinuous] = useState(false);
  const current = active === null ? null : assets[active];
  function open(index: number, button: HTMLButtonElement) {
    opener.current = button;
    setActive(index);
    dialog.current?.showModal();
  }
  function close() {
    dialog.current?.close();
    setActive(null);
    opener.current?.focus();
  }
  function move(delta: number, audioOnly = false) {
    if (active === null) return;
    for (let i = active + delta; i >= 0 && i < assets.length; i += delta) {
      if (
        assets[i]!.type !== "document" &&
        (!audioOnly || assets[i]!.type === "audio")
      ) {
        setActive(i);
        // The active page unmounts; keep keyboard focus inside the persistent dialog controls.
        dialog.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
        return;
      }
    }
  }
  return (
    <>
      <div className="media-grid" aria-label="记忆影像与声音">
        {assets.map((asset, index) =>
          asset.type === "document" ? (
            <MediaBlock key={`${asset.id}-${index}`} assetId={asset.id} {...asset} />
          ) : (
            <button
              key={`${asset.id}-${index}`}
              className="min-h-28 min-w-0 rounded-xl border border-line bg-surface p-3 text-left"
              onClick={(e) => open(index, e.currentTarget)}
              aria-label={`打开阅读器：${asset.filename}`}
            >
              {asset.type === "image" ? (
                <MediaImage
                  assetId={asset.id}
                  mimeType={asset.mimeType}
                  thumbAssetId={asset.thumbnailId}
                  imgClassName="max-h-72 w-full object-contain"
                  alt={asset.filename}
                />
              ) : (
                <span className="block py-8 text-center text-accent">
                  {asset.type === "audio" ? "播放家人的声音" : "打开视频"}
                </span>
              )}
              <span className="mt-2 block break-words text-sm">
                {asset.filename}
              </span>
              {asset.author ? (
                <span className="text-sm text-muted">{asset.author}</span>
              ) : null}
            </button>
          ),
        )}
      </div>
      <dialog
        ref={dialog}
        aria-label="媒体阅读器"
        onCancel={close}
        onClose={() => {
          setActive(null);
          opener.current?.focus();
        }}
        className="fixed inset-0 m-0 h-dvh max-h-dvh w-screen max-w-none overflow-y-auto bg-background p-4 text-foreground backdrop:bg-black/70 sm:p-6"
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).matches("input,select,textarea"))
            return;
          if (event.key === "ArrowRight") {
            event.preventDefault();
            move(1);
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            move(-1);
          }
        }}
      >
        <div className="mx-auto max-w-5xl pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 bg-background py-2">
            <button autoFocus className="ui-button-secondary" onClick={close}>
              关闭阅读器
            </button>
            <span aria-live="polite">
              {active === null ? 0 : active + 1} / {assets.length}
            </span>
            <div className="flex gap-2">
              <button
                className="ui-button-secondary"
                disabled={
                  active === null ||
                  !assets.slice(0, active).some((a) => a.type !== "document")
                }
                onClick={() => move(-1)}
              >
                上一份
              </button>
              <button
                className="ui-button-secondary"
                disabled={
                  active === null ||
                  !assets.slice(active + 1).some((a) => a.type !== "document")
                }
                onClick={() => move(1)}
              >
                下一份
              </button>
            </div>
          </div>
          {current ? (
            <ActiveMedia
              key={current.id}
              asset={current}
              continuous={continuous}
              onContinuous={setContinuous}
              onEnded={() => {
                if (continuous) move(1, true);
              }}
            />
          ) : null}
        </div>
      </dialog>
    </>
  );
}
function ActiveMedia({
  asset,
  continuous,
  onContinuous,
  onEnded,
}: {
  asset: ReaderAsset;
  continuous: boolean;
  onContinuous: (v: boolean) => void;
  onEnded: () => void;
}) {
  const [jobs, setJobs] = useState<MediaDerivation[]>([]),
    [transcript, setTranscript] = useState<ReaderTranscript | null>(null),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false),
    [original, setOriginal] = useState(false),
    [zoom, setZoom] = useState(1),
    [speed, setSpeed] = useState(1),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0);
  const player = useRef<HTMLMediaElement | null>(null);
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function load(first = false) {
      try {
        const response = await fetch(
          `/api/media/${encodeURIComponent(asset.id)}/derivations`,
          {
            method:
              first && ["image", "video"].includes(asset.type) ? "POST" : "GET",
            headers: { "content-type": "application/json" },
            body:
              first && ["image", "video"].includes(asset.type)
                ? JSON.stringify({ kind: "preview" })
                : undefined,
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          if (response.status === 403 || response.status === 404) {
            if (alive) {
              setFailed(true);
              setMessage("来源已删除或当前没有阅读权限。");
            }
            return;
          }
          throw new Error();
        }
        const data = await response.json();
        if (!alive) return;
        setJobs(data.jobs);
        setTranscript(data.transcript);
        setMessage("");
        if (
          data.jobs.some((j: MediaDerivation) =>
            ["queued", "running"].includes(j.status),
          )
        )
          timer = setTimeout(() => void load(), 2000);
      } catch {
        if (alive) setMessage("无法连接服务器，请检查网络后重试。");
      }
    }
    void load(true);
    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [asset.id, asset.type, retry]);
  async function generate(kind: MediaDerivation["kind"]) {
    try {
      const r = await fetch(
        `/api/media/${encodeURIComponent(asset.id)}/derivations`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind }),
        },
      );
      if (!r.ok) throw new Error();
      setRetry((v) => v + 1);
    } catch {
      setMessage("无法开始处理，请稍后重试。原件仍可下载。");
    }
  }
  const preview = jobs.find((j) => j.kind === "preview"),
    transcode = jobs.find((j) => j.kind === "transcode"),
    waveform = jobs.find((j) => j.kind === "waveform");
  const source = `/api/media/${encodeURIComponent(original ? asset.id : asset.type === "image" ? preview?.outputAssetId || asset.thumbnailId || asset.id : transcode?.outputAssetId || asset.id)}`;
  function seek(seconds: number) {
    const media = player.current;
    if (media && Number.isFinite(media.duration) && seconds <= media.duration) {
      media.currentTime = seconds;
      void media.play().catch(() => setMessage("请点播放继续。"));
    }
  }
  return (
    <article>
      <h2 className="my-3 break-words text-xl">{asset.filename}</h2>
      <p className="mb-3 text-sm text-muted">
        {[
          asset.author,
          asset.dateLabel,
          asset.durationMs
            ? `${(asset.durationMs / 1000).toFixed(1)} 秒`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {message ? (
        <p role="alert" className="my-3">
          {message}
        </p>
      ) : null}
      {failed ? (
        <p role="alert">原件已安全保存，当前浏览器可能无法直接预览</p>
      ) : asset.type === "image" ? (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              className="ui-button-secondary"
              disabled={zoom <= 1}
              onClick={() => setZoom((v) => Math.max(1, v - 0.5))}
            >
              缩小
            </button>
            <button
              className="ui-button-secondary"
              disabled={zoom >= 4}
              onClick={() => setZoom((v) => Math.min(4, v + 0.5))}
            >
              放大
            </button>
            <button className="ui-button-secondary" onClick={() => setZoom(1)}>
              适合屏幕
            </button>
            <button
              className="ui-button-secondary"
              onClick={() => {
                setOriginal(true);
                setLoading(true);
              }}
            >
              按需加载原图
            </button>
          </div>
          {loading ? <p role="status">正在加载照片…</p> : null}
          <div className="mt-3 max-h-[70dvh] overflow-auto rounded-xl bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={source}
              alt={asset.filename}
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setFailed(true);
              }}
              className="mx-auto object-contain"
              style={{
                width: `${zoom * 100}%`,
                maxWidth: "none",
                maxHeight: zoom === 1 ? "70dvh" : undefined,
              }}
            />
          </div>
          {!original && preview?.status !== "succeeded" ? (
            <p className="mt-2 text-sm text-muted">
              阅读预览尚未就绪；当前显示可用图片，可主动加载原图。
            </p>
          ) : null}
        </>
      ) : (
        <>
          {asset.type === "video" ? (
            <video
              key={source}
              ref={(node) => {
                player.current = node;
              }}
              controls
              preload="metadata"
              playsInline
              poster={
                preview?.outputAssetId
                  ? `/api/media/${preview.outputAssetId}`
                  : undefined
              }
              src={source}
              className="max-h-[70dvh] w-full bg-black object-contain"
              onWaiting={() => setLoading(true)}
              onLoadedData={() => setLoading(false)}
              onCanPlay={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setFailed(true);
              }}
            />
          ) : (
            <audio
              key={source}
              ref={(node) => {
                player.current = node;
              }}
              controls
              preload="metadata"
              src={source}
              className="w-full"
              onLoadedMetadata={() => {
                setLoading(false);
                if (player.current) player.current.playbackRate = speed;
              }}
              onError={() => {
                setLoading(false);
                setFailed(true);
              }}
              onEnded={onEnded}
              autoPlay={continuous}
            />
          )}
          {loading ? <p role="status">正在加载媒体…</p> : null}
          <div className="my-3 flex flex-wrap items-center gap-3">
            <label>
              播放速度{" "}
              <select
                className="min-h-11 rounded-lg border border-line px-3"
                value={speed}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSpeed(v);
                  if (player.current) player.current.playbackRate = v;
                }}
              >
                {[0.75, 1, 1.25, 1.5, 2].map((v) => (
                  <option key={v} value={v}>
                    {v}×
                  </option>
                ))}
              </select>
            </label>
            {asset.type === "audio" ? (
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={continuous}
                  onChange={(e) => onContinuous(e.target.checked)}
                />
                主动连续播放下一段声音
              </label>
            ) : null}
            <button
              className="ui-button-secondary"
              onClick={() => void generate("transcode")}
            >
              生成兼容播放版
            </button>
            <button
              className="ui-button-secondary"
              onClick={() => void generate("waveform")}
            >
              生成声音波形
            </button>
          </div>
          {waveform?.outputAssetId ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/media/${waveform.outputAssetId}`}
                alt="声音波形（最多前五分钟）"
                className="w-full"
              />
            </>
          ) : null}
          {transcript ? (
            <section aria-label="阅读转录">
              <h3>转录{transcript.edited ? " · 人工修订" : ""}</h3>
              <p className="whitespace-pre-wrap leading-7">{transcript.text}</p>
              {transcript.segments.length ? (
                <details>
                  <summary className="min-h-11 py-2">
                    带真实时间段的原始转录（点句定位）
                  </summary>
                  <ol>
                    {transcript.segments.map((segment, i) => (
                      <li key={i}>
                        <button
                          className="min-h-11 py-2 text-left underline"
                          onClick={() => seek(segment.startSeconds)}
                        >
                          {segment.startSeconds.toFixed(1)} 秒 · {segment.text}
                        </button>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </section>
          ) : null}
        </>
      )}
      {jobs
        .filter((j) => j.status !== "succeeded")
        .map((j) => (
          <p key={j.kind} role="status" className="my-2 text-sm">
            {
              {
                preview: "阅读预览",
                transcode: "兼容播放版",
                waveform: "声音波形",
              }[j.kind]
            }
            ：
            {j.status === "failed"
              ? "处理失败或缺少编解码器，可重试并下载原件。"
              : "等待后台处理；不影响原件阅读。"}
          </p>
        ))}
      <div className="my-4 flex flex-wrap gap-3">
        <button
          className="ui-button-secondary"
          onClick={() => {
            setFailed(false);
            setLoading(true);
            setRetry((v) => v + 1);
          }}
        >
          重新加载
        </button>
        <a
          className="ui-button-secondary"
          href={`/api/media/${encodeURIComponent(asset.id)}?download=1`}
        >
          下载原件
        </a>
      </div>
    </article>
  );
}
