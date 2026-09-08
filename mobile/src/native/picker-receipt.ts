import { classifyImportedFile } from "../storage/import-policy";
import type { LocalImportIntakeItem, MediaCapturePayload } from "../types";

export type PickerReceipt = {
  scope?: string;
  sessionId: string;
  createdAt: string;
  captureId: string;
  index: number;
  payload: MediaCapturePayload;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function recoverPickerReceipt(value: unknown, root: string, exists: (uri: string) => boolean): {
  scope?: string; id: string; createdAt: string; items: LocalImportIntakeItem[];
} | null {
  if (!value || typeof value !== "object") return null;
  const receipt = value as PickerReceipt;
  if (!UUID.test(receipt.sessionId) || !UUID.test(receipt.captureId) ||
    !Number.isSafeInteger(receipt.index) || receipt.index < 0 || receipt.index > 10000 ||
    typeof receipt.createdAt !== "string" || !Number.isFinite(Date.parse(receipt.createdAt))) return null;
  const payload = receipt.payload;
  if (!payload || typeof payload.localUri !== "string" || typeof payload.fileName !== "string" ||
    typeof payload.mimeType !== "string" || payload.lastModified !== null || payload.source !== "files") return null;
  const prefix = `${root.replace(/\/$/u, "")}/${receipt.captureId}.`;
  if (!payload.localUri.startsWith(prefix) || !/^[a-z0-9]{1,8}$/u.test(payload.localUri.slice(prefix.length))) return null;
  const classification = classifyImportedFile(payload.fileName, payload.mimeType);
  if (!classification || classification.mediaType !== payload.mediaType) return null;
  const item: LocalImportIntakeItem = {
    externalId: `picker-${receipt.index}`, captureId: receipt.captureId, sortOrder: receipt.index,
    ...(exists(payload.localUri)
      ? { kind: "file", localUri: payload.localUri, payload }
      : { kind: "error", error: "copy_interrupted" }),
  };
  return { ...(typeof receipt.scope === "string" ? { scope: receipt.scope } : {}), id: receipt.sessionId, createdAt: receipt.createdAt, items: [item] };
}

/** v2 extends the existing picker journal with a whole Live Photo destination. */
export type LivePhotoPickerReceipt = {
  version: 2;
  captureId: string;
  scope: string;
  draftId: string;
  expectedRevision: number;
  createdAt: string;
  originals: { id: string; itemId: string; role: "image" | "video"; payload: MediaCapturePayload }[];
};
export function parseLivePhotoPickerReceipt(value: unknown, root: string): LivePhotoPickerReceipt | null {
  if (!value || typeof value !== "object") return null;
  const r = value as LivePhotoPickerReceipt;
  if (r.version !== 2 || !UUID.test(r.captureId) || typeof r.scope !== "string" || r.scope.length > 4096 ||
    !/^[\w-]{1,128}$/u.test(r.draftId) || !Number.isSafeInteger(r.expectedRevision) || r.expectedRevision < 1 ||
    typeof r.createdAt !== "string" || !Number.isFinite(Date.parse(r.createdAt)) || !Array.isArray(r.originals) || r.originals.length !== 2) return null;
  for (const o of r.originals) {
    if (!o || !UUID.test(o.id) || !UUID.test(o.itemId) || !["image", "video"].includes(o.role)) return null;
    const p = o.payload, prefix = `${root.replace(/\/$/u, "")}/${o.id}.`;
    if (!p || typeof p.localUri !== "string" || !p.localUri.startsWith(prefix) || !/^[a-z0-9]{1,8}$/u.test(p.localUri.slice(prefix.length)) ||
      typeof p.fileName !== "string" || p.fileName.length > 200 || typeof p.mimeType !== "string" ||
      !["camera", "library"].includes(p.source) || (p.lastModified !== null && (!Number.isFinite(p.lastModified) || p.lastModified! < 0)) ||
      p.mediaType !== o.role || classifyImportedFile(p.fileName, p.mimeType)?.mediaType !== o.role) return null;
  }
  if (new Set(r.originals.map(o => o.role)).size !== 2 || new Set(r.originals.map(o => o.id)).size !== 2 || new Set(r.originals.map(o => o.itemId)).size !== 2 || r.originals[0]?.id !== r.captureId) return null;
  return r;
}
