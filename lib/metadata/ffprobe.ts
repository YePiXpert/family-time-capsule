import { spawn } from "node:child_process";

/**
 * ffprobe 增强 metadata（Issue #011，PRD §19：非核心硬依赖）。
 * ffprobe 不存在或执行失败 → 返回 null，上传主流程照常工作。
 * Docker 镜像自带 ffmpeg；本地开发机可能没有。
 */

export type ProbeResult = {
  durationMs: number | null;
  creationTime: Date | null; // 容器内嵌创建时间（通常为 UTC ISO）
  width: number | null;
  height: number | null;
  formatName: string | null;
  raw: unknown;
};

const PROBE_TIMEOUT_MS = 15_000;

function runFfprobe(absPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        absPath,
      ],
      { windowsHide: true },
    );
    let stdout = "";
    let settled = false;
    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", () => done(null)); // ENOENT：未安装
    child.on("close", (code) => done(code === 0 ? stdout : null));
    setTimeout(() => {
      child.kill();
      done(null);
    }, PROBE_TIMEOUT_MS).unref();
  });
}

let ffprobeAvailable: boolean | undefined;

/** 探测媒体文件；ffprobe 缺失/失败返回 null（调用方不感知差异） */
export async function probeMedia(absPath: string): Promise<ProbeResult | null> {
  if (ffprobeAvailable === false) return null;
  const stdout = await runFfprobe(absPath);
  if (stdout === null) {
    ffprobeAvailable = false;
    return null;
  }
  ffprobeAvailable = true;
  try {
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string; tags?: { creation_time?: string }; format_name?: string };
      streams?: Array<{
        width?: number;
        height?: number;
        duration?: string;
        codec_type?: string;
      }>;
    };
    const durationSec = Number(parsed.format?.duration ?? NaN);
    const creation = parsed.format?.tags?.creation_time;
    const videoStream = parsed.streams?.find((s) => s.codec_type === "video");
    return {
      durationMs: Number.isFinite(durationSec) ? Math.round(durationSec * 1000) : null,
      creationTime:
        creation && !Number.isNaN(new Date(creation).getTime())
          ? new Date(creation)
          : null,
      width: videoStream?.width ?? null,
      height: videoStream?.height ?? null,
      formatName: parsed.format?.format_name ?? null,
      raw: parsed,
    };
  } catch {
    return null;
  }
}
