"use client";
import { useState } from "react";

export function ImportedVideoPreview({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return <>
    <video controls playsInline preload="metadata" src={src} className="max-h-64 w-full rounded-xl bg-black" onError={() => setFailed(true)} />
    {failed ? <p role="status" className="mt-2 text-sm text-muted">当前设备不能直接播放这个视频。原件已保留，保存并同步后会尝试生成兼容播放版。</p> : null}
  </>;
}
