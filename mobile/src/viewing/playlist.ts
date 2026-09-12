import type { NativeReaderAsset } from "../media/NativeMediaReader";
import type { ReadingManifest, ReadingMedia } from "../reading/types";
import { readingFileUri } from "../reading/native";

/** Only items in the authorized album manifest enter this viewing session. */
export function familyViewingPlaylist(manifest: ReadingManifest, downloadKey: string | null, progress: Record<string, number>): NativeReaderAsset[] {
  const playlist: NativeReaderAsset[] = [];
  const included = new Set<string>();
  const byId = new Map(manifest.media.map((media) => [media.id, media]));
  function addMedia(media: ReadingMedia | undefined) {
    if (!media || included.has(media.id) || !["image", "video", "audio"].includes(media.type)) return;
    included.add(media.id);
    playlist.push({
      id: media.id, filename: media.filename, type: media.type, mimeType: media.mimeType,
      durationMs: media.durationMs, dateLabel: media.dateLabel, author: media.author ?? undefined,
      localTranscript: media.transcript, initialSeconds: progress[media.id] ?? 0,
      ...(downloadKey ? { localUri: readingFileUri(downloadKey, media), remoteAssetId: media.id } : {}),
    });
  }
  if (manifest.subtitle.trim()) playlist.push({ id: `viewing-intro-${manifest.id}`, filename: manifest.title, type: "text", mimeType: "text/plain", readingText: manifest.subtitle });
  for (const chapter of manifest.chapters) {
    for (const block of chapter.blocks) {
      const text = [block.text.trim(), block.caption.trim()].filter(Boolean).join("\n\n");
      if (text) playlist.push({
        id: `viewing-text-${chapter.id}-${block.id}`, filename: block.sourceLabels[0] || chapter.title,
        type: "text", mimeType: "text/plain", readingText: text, dateLabel: block.dateLabel, author: block.author ?? undefined,
      });
      block.images.forEach((id) => addMedia(byId.get(id)));
      if (block.memoryEventId) manifest.media.filter((media) => media.memoryEventId === block.memoryEventId).forEach(addMedia);
    }
  }
  // Standalone sounds and videos have no image-block reference in existing downloads.
  manifest.media.forEach(addMedia);
  return playlist;
}
