"use client";

import { useState } from "react";

/**
 * 媒体渲染 + 浏览器兼容 fallback（RH-001）：
 * - HEIC/HEIF 大多数桌面浏览器无法解码 → 直接显示「原件已安全保存」占位 + 鉴权下载；
 * - <img>/<video> 解码失败（onError）→ 同样降级，绝不误导用户以为文件损坏；
 * - 永远提供「下载/打开原件」入口；原件从不为预览而转换或替换。
 */

const FALLBACK_TEXT = "原件已安全保存，当前浏览器可能无法直接预览";

function FallbackTile({
  label,
  filename,
  assetId,
  className = "",
}: {
  label: string;
  filename?: string;
  assetId: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border border-foreground/10 bg-foreground/[0.03] p-3 text-center ${className}`}
    >
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[11px] leading-4 text-foreground/50">{FALLBACK_TEXT}</span>
      <a
        href={`/api/media/${assetId}?download=1`}
        className="text-[11px] underline underline-offset-2 hover:text-accent"
      >
        下载 / 打开原件
      </a>
      {filename && (
        <span className="max-w-full truncate text-[11px] text-foreground/40" title={filename}>
          {filename}
        </span>
      )}
    </div>
  );
}

/** HEIC/HEIF（桌面浏览器普遍不可解码）或解码失败时的图片渲染；有缩略图时优先用缩略图 */
export function MediaImage({
  assetId,
  filename,
  mimeType,
  thumbAssetId,
  className = "",
  imgClassName = "",
  alt,
}: {
  assetId: string;
  filename?: string;
  mimeType: string;
  /** 缩略图衍生物（image/webp）；提供时用它展示，加载失败回退原件 */
  thumbAssetId?: string | null;
  className?: string;
  imgClassName?: string;
  alt?: string;
}) {
  const heicLike = mimeType === "image/heic" || mimeType === "image/heif";
  const [failed, setFailed] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  // HEIC 原件桌面端多不可解码，但缩略图是 WebP——可显示
  if (heicLike && (!thumbAssetId || thumbFailed)) {
    return (
      <FallbackTile
        label="HEIC 照片"
        filename={filename}
        assetId={assetId}
        className={className}
      />
    );
  }
  if (failed) {
    return (
      <FallbackTile
        label="照片"
        filename={filename}
        assetId={assetId}
        className={className}
      />
    );
  }
  const src = thumbAssetId && !thumbFailed ? `/api/media/${thumbAssetId}` : `/api/media/${assetId}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt ?? filename ?? ""}
      className={imgClassName}
      onError={() => {
        if (thumbAssetId && !thumbFailed) setThumbFailed(true); // 缩略图坏了 → 试原件
        else setFailed(true); // 原件也坏 → 占位
      }}
    />
  );
}

/** 视频渲染：优先 <video>；解码失败 → 明确提示 + 下载入口 */
export function MediaVideo({
  assetId,
  filename,
  mimeType,
  className = "",
  videoClassName = "",
}: {
  assetId: string;
  filename?: string;
  mimeType: string;
  className?: string;
  videoClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <FallbackTile
        label={mimeType === "video/quicktime" ? "MOV 视频" : "视频"}
        filename={filename}
        assetId={assetId}
        className={className}
      />
    );
  }
  return (
    <video
      controls
      preload="metadata"
      src={`/api/media/${assetId}`}
      className={videoClassName}
      onError={() => setFailed(true)}
    />
  );
}

/** 通用媒体块（事件详情页）：图片/视频/音频/文件 + 底部下载链接 */
export function MediaBlock({
  assetId,
  filename,
  mimeType,
  type,
  durationMs,
  bytes,
  thumbAssetId,
}: {
  assetId: string;
  filename: string;
  mimeType: string;
  type: string;
  durationMs?: number | null;
  bytes?: number | null;
  thumbAssetId?: string | null;
}) {
  const [videoFailed, setVideoFailed] = useState(false);
  return (
    <div className="w-full">
      {type === "image" ? (
        <MediaImage
          assetId={assetId}
          filename={filename}
          mimeType={mimeType}
          thumbAssetId={thumbAssetId}
          className="aspect-video w-full"
          imgClassName="max-h-[28rem] w-full rounded-lg border border-foreground/10 object-contain"
        />
      ) : type === "video" ? (
        videoFailed ? (
          <FallbackTile
            label={mimeType === "video/quicktime" ? "MOV 视频" : "视频"}
            filename={filename}
            assetId={assetId}
            className="aspect-video w-full"
          />
        ) : (
          <video
            controls
            preload="metadata"
            src={`/api/media/${assetId}`}
            className="max-h-[28rem] w-full rounded-lg border border-foreground/10"
            onError={() => setVideoFailed(true)}
          />
        )
      ) : type === "audio" ? (
        <audio controls preload="metadata" src={`/api/media/${assetId}`} className="w-full" />
      ) : (
        <div className="rounded-lg border border-foreground/10 px-4 py-3 text-sm">
          <p className="font-medium">{filename}</p>
          <p className="mt-1 text-xs text-muted">
            {mimeType} {bytes ? `· ${(bytes / 1024).toFixed(bytes >= 1024 * 1024 ? 0 : 1)} KB` : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {mimeType === "application/pdf" ? (
              <a href={`/api/media/${assetId}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                在浏览器中打开 PDF
              </a>
            ) : null}
            {(mimeType === "text/plain" || mimeType === "text/markdown") ? (
              <a href={`/api/media/${assetId}/text-preview`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                安全文本预览
              </a>
            ) : null}
            <a href={`/api/media/${assetId}?download=1`} className="underline underline-offset-2">
              下载原件
            </a>
          </div>
        </div>
      )}
      <p className="mt-1 flex items-center gap-2 truncate text-xs text-foreground/40" title={filename}>
        <span className="truncate">{filename}</span>
        {durationMs ? <span>· {(durationMs / 1000).toFixed(1)} 秒</span> : null}
        {type !== "document" ? <a
          href={`/api/media/${assetId}?download=1`}
          className="shrink-0 underline underline-offset-2 hover:text-accent"
        >
          下载原件
        </a> : null}
      </p>
    </div>
  );
}
