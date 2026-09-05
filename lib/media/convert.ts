import "server-only";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import sharp from "sharp";
import { ffmpegBinary } from "./ffmpeg";
import type { AssetRow } from "@/lib/assets/service";
export type MediaDerivationKind = "preview" | "transcode" | "waveform";
export const MEDIA_OUTPUT_LIMIT = 128 * 1024 * 1024;
export const MEDIA_TIMEOUT_MS = 180_000;
export class MediaConversionError extends Error {}
const demuxers: Record<string, string> = {
  "video/mp4": "mov",
  "video/quicktime": "mov",
  "audio/mp4": "mov",
  "audio/x-m4a": "mov",
  "video/webm": "matroska",
  "audio/webm": "matroska",
  "video/x-matroska": "matroska",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "video/ogg": "ogg",
  "audio/flac": "flac",
  "audio/aac": "aac",
};
/** Explicit demuxers reject playlists; no shell, URL input or user-supplied filters. */
async function ffmpeg(
  args: string[],
  outputPath: string,
  signal?: AbortSignal,
) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ ffmpegBinary(), args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
    let cause: string | undefined;
    const stop = () => {
      cause = "cancelled";
      child.kill("SIGKILL");
    };
    const monitor = setInterval(() => {
      void stat(outputPath)
        .then((info) => {
          if (info.size >= MEDIA_OUTPUT_LIMIT) {
            cause = "derivative_output_limit";
            child.kill("SIGKILL");
          }
        })
        .catch(() => undefined);
    }, 100);
    const timer = setTimeout(() => {
      cause = "conversion_timeout";
      child.kill("SIGKILL");
    }, MEDIA_TIMEOUT_MS);
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    child.once("error", (error: NodeJS.ErrnoException) => {
      cause =
        error.code === "ENOENT" ? "codec_unavailable" : "conversion_failed";
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      clearInterval(monitor);
      signal?.removeEventListener("abort", stop);
      if (code === 0 && !cause) resolve();
      else
        reject(new MediaConversionError(cause || "codec_or_media_unsupported"));
    });
  });
}
export async function convertMedia(
  original: AssetRow,
  kind: MediaDerivationKind,
  inputPath: string,
  outputPath: string,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new MediaConversionError("cancelled");
  let mimeType: string, extension: string, type: "image" | "audio" | "video";
  if (kind === "preview" && original.type === "image") {
    await sharp(inputPath, { limitInputPixels: 64_000_000, animated: false })
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .timeout({ seconds: 30 })
      .toFile(outputPath);
    mimeType = "image/webp";
    extension = "webp";
    type = "image";
  } else {
    const demuxer = demuxers[original.mimeType];
    if (!demuxer) throw new MediaConversionError("codec_or_media_unsupported");
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-n",
      "-threads",
      "1",
      "-max_alloc",
      "67108864",
      "-protocol_whitelist",
      "file,pipe",
      "-f",
      demuxer,
      "-i",
      inputPath,
      "-map_metadata",
      "-1",
      "-threads",
      "1",
      "-filter_threads",
      "1",
    ];
    if (kind === "preview" && original.type === "video") {
      args.push(
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-vf",
        "scale=1280:1280:force_original_aspect_ratio=decrease",
        "-c:v",
        "mjpeg",
        "-q:v",
        "3",
        "-f",
        "image2",
      );
      mimeType = "image/jpeg";
      extension = "jpg";
      type = "image";
    } else if (
      kind === "waveform" &&
      ["audio", "video"].includes(original.type)
    ) {
      args.push(
        "-filter_complex",
        "[0:a:0]atrim=duration=300,aresample=8000,aformat=channel_layouts=mono,showwavespic=s=1200x180:colors=0xa05d46[out]",
        "-map",
        "[out]",
        "-frames:v",
        "1",
        "-c:v",
        "png",
        "-f",
        "image2",
      );
      mimeType = "image/png";
      extension = "png";
      type = "image";
    } else if (kind === "transcode" && original.type === "video") {
      args.push(
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        "scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "25",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
      );
      mimeType = "video/mp4";
      extension = "mp4";
      type = "video";
    } else if (kind === "transcode" && original.type === "audio") {
      args.push(
        "-map",
        "0:a:0",
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
      );
      mimeType = "audio/mp4";
      extension = "m4a";
      type = "audio";
    } else throw new MediaConversionError("unsupported_derivation");
    args.push(outputPath);
    await ffmpeg(args, outputPath, signal);
  }
  const info = await stat(outputPath);
  // Conversion is killed on overflow; a truncated success is never published.
  if (!info.size || info.size >= MEDIA_OUTPUT_LIMIT)
    throw new MediaConversionError("derivative_output_limit");
  if (signal?.aborted) throw new MediaConversionError("cancelled");
  return { mimeType, extension, type, bytes: info.size };
}
