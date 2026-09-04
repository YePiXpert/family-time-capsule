import { classifyImportedFile } from "../storage/import-policy";
import type { LocalImportIntakeItem, MediaCapturePayload } from "../types";

export type PickerReceipt = {
  sessionId: string;
  createdAt: string;
  captureId: string;
  index: number;
  payload: MediaCapturePayload;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function recoverPickerReceipt(value: unknown, root: string, exists: (uri: string) => boolean): {
  id: string; createdAt: string; items: LocalImportIntakeItem[];
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
  return { id: receipt.sessionId, createdAt: receipt.createdAt, items: [item] };
}
