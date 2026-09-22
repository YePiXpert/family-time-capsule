import {
  type PhotoMetadata,
  type RecordDraft,
} from "./model";

function captureTime(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(
    value.trim(),
  );
  if (!match) return;
  const [, y, m, d, h, min, sec] = match;
  const iso = `${y}-${m}-${d}T${h}:${min}:${sec}`;
  // Validate in UTC to avoid daylight-saving gaps in the importing device's zone.
  const check = new Date(`${iso}Z`);
  if (
    +y! < 1 ||
    !Number.isFinite(check.getTime()) ||
    check.toISOString().slice(0, 19) !== iso
  )
    return;
  return iso;
}

function coordinate(
  value: unknown,
  ref: unknown,
  limit: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  const direction = typeof ref === "string" ? ref.toUpperCase() : "";
  const result =
    direction === "S" || direction === "W" ? -Math.abs(value) : value;
  return Math.abs(result) <= limit ? result : undefined;
}

export function readPhotoMetadata(
  exif?: Record<string, unknown> | null,
): PhotoMetadata | undefined {
  if (!exif) return;
  // DateTime may describe an edit/export; only use original/digitized capture tags.
  const capturedAt =
    captureTime(exif.DateTimeOriginal) ?? captureTime(exif.DateTimeDigitized);
  const latitude = coordinate(exif.GPSLatitude, exif.GPSLatitudeRef, 90);
  const longitude = coordinate(exif.GPSLongitude, exif.GPSLongitudeRef, 180);
  const result: PhotoMetadata = {};
  if (capturedAt) result.capturedAt = capturedAt;
  if (latitude !== undefined && longitude !== undefined) {
    result.latitude = latitude;
    result.longitude = longitude;
  }
  return Object.keys(result).length ? result : undefined;
}

export function applyPhotoMetadata(
  draft: RecordDraft,
  metadata?: PhotoMetadata,
): RecordDraft {
  if (!metadata || draft.recordId) return draft;
  const next = { ...draft, content: { ...draft.content } };
  if (draft.autoDate && metadata.capturedAt) {
    next.content.date = metadata.capturedAt;
    next.autoDate = false;
  }
  if (
    draft.autoLocation &&
    !draft.content.location &&
    metadata.latitude !== undefined &&
    metadata.longitude !== undefined
  ) {
    next.content.location = `${metadata.latitude.toFixed(6)}, ${metadata.longitude.toFixed(6)}`;
    next.autoLocation = false;
  }
  return next;
}
