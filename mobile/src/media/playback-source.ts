import { File } from "expo-file-system";

export type PlaybackSource = { uri: string; headers?: Record<string, string> };
export type PlaybackFailureKind = "missing" | "access" | "network" | "server" | "unsupported" | "timeout";
export type PlaybackFailure = { kind: PlaybackFailureKind; message: string };

export function mediaRequestFailure(error: unknown): PlaybackFailure {
  const status = (error as { status?: number })?.status;
  if (status === 401) return { kind: "access", message: "登录已过期，请重新登录后播放。" };
  if (status === 403) return { kind: "access", message: "当前没有阅读权限，请联系资料所有者。" };
  if (status === 404) return { kind: "missing", message: "来源已删除或当前没有阅读权限。" };
  return { kind: "network", message: "无法连接服务器，请检查网络后重试。" };
}

/** Read two bytes, with the same credentials as the native player, before blaming a codec. */
export async function inspectPlaybackFailure(
  source: PlaybackSource,
  local: boolean,
  nativeMessage: string,
  signal: AbortSignal,
): Promise<PlaybackFailure> {
  if (local) {
    try {
      if (source.uri.startsWith("file:") && !new File(source.uri).exists)
        return { kind: "missing", message: "本机视频文件已不在原位置，请重新选择原件或下载后重试。" };
    } catch {
      return { kind: "missing", message: "无法读取本机视频，请重新选择原件或下载后重试。" };
    }
    return { kind: "unsupported", message: "原件已保存在本机，此设备不能直接播放该编码。连接家庭服务器后，可为已同步的原件生成兼容播放版。" };
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  try {
    const response = await fetch(source.uri, {
      headers: { ...source.headers, Range: "bytes=0-1" }, signal: controller.signal,
    });
    const range = /^bytes 0-1\/(\d+)$/i.exec(response.headers.get("content-range") || "");
    if ([401, 403, 404].includes(response.status)) {
      await response.body?.cancel();
      return mediaRequestFailure({ status: response.status });
    }
    if (response.status !== 206 || !range || Number(range[1]) < 2) {
      await response.body?.cancel();
      return { kind: "server", message: "服务器未正确返回视频分段数据，请检查媒体服务后重试。" };
    }
    if (!/^video\//i.test(response.headers.get("content-type") || "")) {
      await response.body?.cancel();
      return { kind: "server", message: "服务器返回的内容不是视频，请检查媒体服务后重试。" };
    }
    if (!await hasTwoBytes(response))
      return { kind: "server", message: "服务器返回的视频分段数据不完整，请检查媒体服务后重试。" };
    if (/network|connection|offline|timed? ?out|NSURLError|\b-100[1-9]\b/i.test(nativeMessage))
      return { kind: "network", message: "视频连接中断，请检查网络后重试。" };
    return { kind: "unsupported", message: "原视频可读取，但此设备无法播放该编码。" };
  } catch {
    return { kind: "network", message: "无法连接服务器，请检查网络后重试。" };
  } finally {
    controller.abort();
    signal.removeEventListener("abort", abort);
  }
}

async function hasTwoBytes(response: Response) {
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) !== 2) {
    await response.body?.cancel();
    return false;
  }
  const reader = response.body?.getReader();
  if (!reader) return (await response.arrayBuffer()).byteLength === 2;
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return bytes === 2;
      bytes += chunk.value.byteLength;
      if (bytes > 2) return false;
    }
  } finally {
    await reader.cancel();
  }
}

export function derivationFailure(code: string | null): string {
  switch (code) {
    case "codec_unavailable": return "服务器缺少视频转换工具，请安装 FFmpeg 后重试。";
    case "codec_or_media_unsupported": return "视频编码不受转换工具支持或文件不完整，原件仍保留。";
    case "conversion_timeout": return "视频转换超时，请重试；较长视频可能需要更多处理时间。";
    case "derivative_output_limit": return "兼容视频超过服务器处理大小限制，原件仍保留。";
    case "derivative_quota": return "服务器处理队列或存储空间已满，请稍后重试。";
    case "worker_interrupted": return "服务器的视频处理任务中断，请重试。";
    case "cancelled": return "视频处理已中断，请重试。";
    default: return "视频处理失败，原件仍保留，请重试。";
  }
}
