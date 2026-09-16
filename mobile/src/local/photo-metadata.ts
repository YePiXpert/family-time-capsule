import {
  clone,
  saveRecord,
  type Library,
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

export function photoDayGroups(
  draft: RecordDraft,
  media: Library["media"],
): RecordDraft["content"][] {
  if (
    draft.recordId ||
    !draft.groupPhotosByDay ||
    !draft.content.mediaIds.length
  )
    return [clone(draft.content)];
  if (draft.photoEvents) {
    const remaining = new Set(draft.content.mediaIds);
    const events = draft.photoEvents.flatMap((event) => {
      const mediaIds = event.mediaIds.filter((id) => remaining.delete(id));
      if (!mediaIds.length) return [];
      return [
        {
          ...clone(event),
          mediaIds,
          coverId:
            event.coverId && mediaIds.includes(event.coverId)
              ? event.coverId
              : (mediaIds.find((id) => media[id]?.kind === "image") ?? null),
        },
      ];
    });
    if (remaining.size)
      events.push(
        ...photoDayGroups(
          {
            ...draft,
            photoEvents: undefined,
            content: { ...draft.content, mediaIds: [...remaining] },
          },
          media,
        ),
      );
    return events;
  }
  const groups = new Map<string, RecordDraft["content"]>();
  for (const id of draft.content.mediaIds) {
    const item = media[id];
    const capturedAt = item?.photoMetadata?.capturedAt;
    const day = capturedAt?.slice(0, 10) ?? "undated";
    let group = groups.get(day);
    if (!group) {
      group = {
        ...clone(draft.content),
        date: capturedAt ?? draft.content.date,
        location: draft.manualLocation ? draft.content.location : "",
        mediaIds: [],
        coverId: null,
      };
      groups.set(day, group);
    }
    group.mediaIds.push(id);
    if (
      item?.kind === "image" &&
      (!group.coverId || id === draft.content.coverId)
    )
      group.coverId = id;
    const metadata = item?.photoMetadata;
    if (
      !draft.manualLocation &&
      !group.location &&
      metadata?.latitude !== undefined &&
      metadata.longitude !== undefined
    )
      group.location = `${metadata.latitude.toFixed(6)}, ${metadata.longitude.toFixed(6)}`;
  }
  return [...groups.values()];
}

export function movePhotoToEvent(
  groups: RecordDraft["content"][],
  mediaId: string,
  target: number | "new",
  media: Library["media"],
) {
  const next = clone(groups);
  const source = next.find((group) => group.mediaIds.includes(mediaId));
  if (!source) return next;
  if (target === "new") {
    if (source.mediaIds.length === 1) return next;
    next.push({
      ...clone(source),
      title: "",
      text: "",
      date: media[mediaId]?.photoMetadata?.capturedAt ?? source.date,
      location:
        media[mediaId]?.photoMetadata?.latitude !== undefined &&
        media[mediaId]?.photoMetadata?.longitude !== undefined
          ? `${media[mediaId]!.photoMetadata!.latitude!.toFixed(6)}, ${media[mediaId]!.photoMetadata!.longitude!.toFixed(6)}`
          : "",
      mediaIds: [mediaId],
      coverId: media[mediaId]?.kind === "image" ? mediaId : null,
    });
  } else {
    const destination = next[target];
    if (!destination || destination === source) return next;
    destination.mediaIds.push(mediaId);
  }
  source.mediaIds = source.mediaIds.filter((id) => id !== mediaId);
  if (source.coverId === mediaId) source.coverId = null;
  return next.filter((group) => group.mediaIds.length);
}

/** Called inside one store transaction so the entire batch saves or remains a draft. */
export function savePhotoDays(
  s: Library,
  draftId: string,
  newId: () => string,
  now: string,
) {
  const draft = s.drafts[draftId];
  if (!draft) throw new Error("未找到这份草稿。");
  const groups = photoDayGroups(draft, s.media);
  return groups.map((content) => {
    s.drafts[draftId] = { ...draft, content };
    return saveRecord(s, draftId, newId(), now);
  });
}
