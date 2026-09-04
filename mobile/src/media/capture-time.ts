export type MediaCaptureSource = "camera" | "library" | "recorder";

export type MediaLibraryTimes = {
  creationTime: number | null;
  modificationTime: number | null;
};

function validTimestamp(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Only live capture/recording may use the current clock. Library imports must
 * carry a timestamp read from the selected system asset, never the pick time.
 */
export async function resolveReliableMediaTime(
  source: MediaCaptureSource,
  assetId: string | null | undefined,
  readLibraryTimes: (assetId: string) => Promise<MediaLibraryTimes>,
  now: () => number = Date.now,
): Promise<number | null> {
  if (source === "camera" || source === "recorder") return now();
  if (!assetId) return null;
  try {
    const info = await readLibraryTimes(assetId);
    if (validTimestamp(info.creationTime)) return info.creationTime;
    if (validTimestamp(info.modificationTime)) return info.modificationTime;
  } catch {
    // Limited permission, document-provider URIs and deleted assets are valid
    // import cases; lack of metadata must not make the import fail.
  }
  return null;
}
