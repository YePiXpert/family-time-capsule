import type { NativeShareManifest } from "../../modules/share-intake/src";
import { classifyImportedFile } from "../storage/import-policy";
import type { LocalImportIntakeItem, MediaCapturePayload } from "../types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function normalizeNativeShareManifest(
  manifest: NativeShareManifest,
  isDurablePrivateFile: (uri: string) => boolean,
): { id: string; createdAt: string; items: LocalImportIntakeItem[] } | null {
  if (!UUID_PATTERN.test(manifest.manifestId) || !Array.isArray(manifest.items) || manifest.items.length > 100) {
    return null;
  }
  const created = new Date(manifest.createdAt);
  const createdAt = Number.isNaN(created.getTime()) ? new Date().toISOString() : created.toISOString();
  const externalIds = new Set<string>();
  const captureIds = new Set<string>();
  const items: LocalImportIntakeItem[] = [];
  for (const item of manifest.items) {
    if (!item || typeof item.externalId !== "string" || externalIds.has(item.externalId) ||
      !UUID_PATTERN.test(item.captureId) || captureIds.has(item.captureId)) continue;
    externalIds.add(item.externalId);
    captureIds.add(item.captureId);
    if (item.kind === "text" && typeof item.text === "string" && item.text.trim()) {
      items.push({
        externalId: item.externalId,
        captureId: item.captureId,
        kind: "text",
        payload: { text: item.text.trim().slice(0, 5000) },
      });
      continue;
    }
    if (item.kind === "file" && typeof item.localUri === "string" &&
      typeof item.fileName === "string" && typeof item.mimeType === "string") {
      const classification = classifyImportedFile(item.fileName, item.mimeType);
      if (classification && isDurablePrivateFile(item.localUri)) {
        const payload: MediaCapturePayload = {
          localUri: item.localUri,
          fileName: item.fileName.slice(0, 200),
          mimeType: classification.mimeType,
          mediaType: classification.mediaType,
          lastModified: null,
          source: "system_share",
        };
        items.push({
          externalId: item.externalId,
          captureId: item.captureId,
          kind: "file",
          localUri: item.localUri,
          payload,
        });
        continue;
      }
    }
    items.push({
      externalId: item.externalId,
      captureId: item.captureId,
      kind: "error",
      error: item.error?.slice(0, 160) || "invalid_shared_item",
    });
  }
  return items.length > 0 ? { id: manifest.manifestId, createdAt, items } : null;
}
