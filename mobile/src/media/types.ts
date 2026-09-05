export type ReaderAsset = {
  id: string;
  type: string;
  filename: string;
  mimeType: string;
  thumbnailId?: string | null;
  durationMs?: number | null;
  author?: string;
  dateLabel?: string;
};
export type MediaDerivation = {
  kind: "preview" | "transcode" | "waveform";
  status: "queued" | "running" | "succeeded" | "failed";
  outputAssetId: string | null;
  errorCode: string | null;
};
export type ReaderTranscript = {
  text: string;
  edited: boolean;
  segments: { startSeconds: number; endSeconds: number; text: string }[];
};
/** Never infer sentence timestamps from text length or recording duration. */
export function parseReaderSegments(
  json: string | null,
): ReaderTranscript["segments"] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.length > 5000) return [];
    return parsed
      .filter(
        (s): s is ReaderTranscript["segments"][number] =>
          Boolean(s) &&
          typeof s === "object" &&
          Number.isFinite(s.startSeconds) &&
          s.startSeconds >= 0 &&
          Number.isFinite(s.endSeconds) &&
          s.endSeconds > s.startSeconds &&
          typeof s.text === "string" &&
          s.text.length <= 10000,
      )
      .map(({ startSeconds, endSeconds, text }) => ({
        startSeconds,
        endSeconds,
        text,
      }));
  } catch {
    return [];
  }
}
