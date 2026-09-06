/** Product limits shared by enqueue validation and media handlers. */
export const SHORT_VIDEO_MAX_MS = 120_000;
export const SHORT_VIDEO_MAX_BYTES = 128 * 1024 * 1024;
export const SHORT_VIDEO_AUDIO_MAX_BYTES = 4 * 1024 * 1024;
export const SHORT_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
export function shortVideoError(asset: { mimeType: string; bytes: number; durationMs: number | null }): string | null {
  if (!SHORT_VIDEO_MIME_TYPES.has(asset.mimeType)) return "unsupported_media_type";
  if (asset.bytes > SHORT_VIDEO_MAX_BYTES) return "video_too_large";
  if (asset.durationMs !== null && (!Number.isFinite(asset.durationMs) || asset.durationMs <= 0 || asset.durationMs > SHORT_VIDEO_MAX_MS)) return "video_duration_limit";
  return null;
}
