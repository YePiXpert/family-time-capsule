import "server-only";

import { spawn } from "node:child_process";

/**
 * ffmpeg 视频抽帧（M3-G）。
 *
 * - 非核心硬依赖：ffmpeg 缺失/失败 → unavailable，视频分析优雅降级，
 *   原件与其余功能完全不受影响（与 ffprobe 同样的策略）；
 * - 帧是临时的 vision 输入：只进内存（有总字节上限），绝不写成 asset 行；
 * - 代表帧策略：≤30s 取 3 帧（约开头/中间/结尾），更长视频均匀取最多 6 帧。
 */

const FRAME_TIMEOUT_MS = 30_000;
/** 单帧最大边长（保持纵横比，小图不放大） */
const MAX_FRAME_EDGE = 1280;
/** 全部帧合计字节上限（vision 输入远小于此） */
const MAX_TOTAL_FRAME_BYTES = 12 * 1024 * 1024;
/** 单帧 jpeg 输出体积防御上限 */
const MAX_SINGLE_FRAME_BYTES = 4 * 1024 * 1024;
const SHORT_VIDEO_FRAMES = 3;
const LONG_VIDEO_FRAMES = 6;
const SHORT_VIDEO_SECONDS = 30;

export type ExtractedFrame = {
  /** 帧在视频中的时间点（秒，用于结果标注） */
  atSeconds: number;
  bytes: Uint8Array;
};

export type ExtractFramesResult =
  | { status: "ok"; frames: ExtractedFrame[] }
  | { status: "unavailable" }
  | { status: "failed" };

/** ffmpeg 二进制：默认从 PATH 解析（Docker 镜像内置），可 FFMPEG_PATH 覆盖。 */
export function ffmpegBinary(): string {
  return process.env.FFMPEG_PATH ?? "ffmpeg";
}

/** 依据时长计算采样点（秒）。 */
export function samplePoints(durationSeconds: number | null): number[] {
  if (durationSeconds === null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return [0];
  }
  const count = durationSeconds <= SHORT_VIDEO_SECONDS ? SHORT_VIDEO_FRAMES : LONG_VIDEO_FRAMES;
  // 避免死贴 0 与结尾（黑帧/片尾常见），在 [0.5s, duration-0.5s] 内均匀取点
  const start = Math.min(0.5, durationSeconds / 2);
  const end = Math.max(durationSeconds - 0.5, start);
  if (count <= 1 || end - start < 0.2) return [start];
  const points: number[] = [];
  for (let i = 0; i < count; i++) {
    points.push(start + ((end - start) * i) / (count - 1));
  }
  return points;
}

function extractFrameAt(
  binary: string,
  absPath: string,
  atSeconds: number,
): Promise<{ status: "ok"; bytes: Uint8Array } | { status: "empty" } | { status: "unavailable" } | { status: "failed" }> {
  return new Promise((resolve) => {
    const child = spawn(
      /* turbopackIgnore: true */ binary,
      [
        "-v",
        "quiet",
        "-ss",
        atSeconds.toFixed(3),
        "-i",
        absPath,
        "-frames:v",
        "1",
        "-vf",
        `scale='min(${MAX_FRAME_EDGE},iw)':-2`,
        "-q:v",
        "4",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ],
      { windowsHide: true },
    );
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const done = (
      value: { status: "ok"; bytes: Uint8Array } | { status: "empty" } | { status: "unavailable" } | { status: "failed" },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > MAX_SINGLE_FRAME_BYTES) {
        child.kill();
        done({ status: "failed" });
        return;
      }
      chunks.push(chunk);
    });
    const stderrText = () => {
      child.stderr.resume();
    };
    stderrText();
    child.on("error", (error: NodeJS.ErrnoException) =>
      done(error.code === "ENOENT" ? { status: "unavailable" } : { status: "failed" }),
    );
    child.on("close", (code) => {
      if (code !== 0) {
        done({ status: "failed" });
        return;
      }
      if (total === 0) {
        done({ status: "empty" });
        return;
      }
      done({ status: "ok", bytes: new Uint8Array(Buffer.concat(chunks)) });
    });
    const timeout = setTimeout(() => {
      child.kill();
      done({ status: "failed" });
    }, FRAME_TIMEOUT_MS);
    timeout.unref();
  });
}

let unavailableBinary: string | undefined;

/** 从视频抽代表帧。ffmpeg 缺失 → unavailable；逐帧失败容忍（保留成功帧）。 */
export async function extractVideoFrames(
  absPath: string,
  options: { durationSeconds: number | null; maxFrames?: number },
): Promise<ExtractFramesResult> {
  const binary = ffmpegBinary();
  if (unavailableBinary === binary) return { status: "unavailable" };

  const maxFrames = Math.max(1, Math.min(options.maxFrames ?? LONG_VIDEO_FRAMES, LONG_VIDEO_FRAMES));
  const points = samplePoints(options.durationSeconds).slice(0, maxFrames);

  const frames: ExtractedFrame[] = [];
  let totalBytes = 0;
  for (const atSeconds of points) {
    const result = await extractFrameAt(binary, absPath, atSeconds);
    if (result.status === "unavailable") {
      unavailableBinary = binary;
      return { status: "unavailable" };
    }
    if (result.status === "ok") {
      totalBytes += result.bytes.byteLength;
      frames.push({ atSeconds, bytes: result.bytes });
      if (totalBytes >= MAX_TOTAL_FRAME_BYTES) break;
    }
    // empty / failed 的单帧：跳过，继续其余采样点
  }

  if (frames.length === 0) {
    return { status: "failed" };
  }
  unavailableBinary = undefined;
  return { status: "ok", frames };
}

/** 测试专用：清除“二进制不可用”记忆。 */
export function resetFfmpegUnavailableCacheForTests(): void {
  unavailableBinary = undefined;
}
