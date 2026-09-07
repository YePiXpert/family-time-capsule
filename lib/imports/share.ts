import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { importSession, importSessionItem } from "@/db/schema/import";
import type { FamilyContext } from "@/lib/family/context";
import { appendUploadChunk, completeUpload, createImportSession, createImportedTextCapture, createUploadSession, declareImportItems, getImportSessionDetail, RESUMABLE_CHUNK_BYTES, UploadServiceError } from "./service";

/** PWA multipart intake uses the same preserved originals and recoverable
 * transfer receipts as Files/native, and does not publish a memory. */
export async function receiveWebShare(context: FamilyContext, files: File[], text: string) {
  if (files.length > 100 || text.length > 10_000 || (!files.length && !text.trim())) throw new UploadServiceError("invalid_share", 400);
  const session = await createImportSession({ familyId: context.familyId, createdByUserId: context.userId, source: "share" });
  if (text.trim()) createImportedTextCapture(context.familyId, context.userId, session.id, randomUUID(), text);
  const declarations = [];
  for (const file of files) {
    const first = Buffer.from(await file.slice(0, 64 * 1024).arrayBuffer());
    const last = Buffer.from(await file.slice(Math.max(first.length, file.size - 64 * 1024)).arrayBuffer());
    const clientFingerprint = createHash("sha256").update(`${file.name}\0${file.size}\0${file.lastModified}\0`).update(first).update(last).digest("hex");
    declarations.push({ captureId: randomUUID(), filename: file.name || "分享的文件", declaredMime: file.type || "application/octet-stream", totalBytes: file.size, lastModified: file.lastModified || null, clientFingerprint });
  }
  if (declarations.length) declareImportItems(context.familyId, session.id, declarations);
  for (const [index, declaration] of declarations.entries()) {
    try {
      const { session: upload } = await createUploadSession({ ...declaration, familyId: context.familyId, userId: context.userId, source: "share", importSessionId: session.id, lastModified: declaration.lastModified ? new Date(declaration.lastModified) : null });
      const file = files[index]!;
      for (let offset = 0; offset < file.size; offset += RESUMABLE_CHUNK_BYTES) {
        const chunk = Buffer.from(await file.slice(offset, offset + RESUMABLE_CHUNK_BYTES).arrayBuffer());
        await appendUploadChunk({ familyId: context.familyId, uploadId: upload.id, offset, contentLength: chunk.length, body: Readable.from([chunk]) });
      }
      await completeUpload(context.familyId, upload.id);
    } catch (error) {
      // Disk/validation errors remain visible alongside successful originals.
      // A crash without this commit leaves a pending resumable receipt.
      const detail = (await getImportSessionDetail(context.familyId, session.id))!;
      const item = detail.items.find(row => row.item.captureId === declaration.captureId)?.item;
      if (item && item.status !== "completed" && item.status !== "failed") getDb().transaction(tx => {
        tx.update(importSessionItem).set({ status: "failed", errorCode: error instanceof UploadServiceError ? error.code : "storage_error", updatedAt: new Date() }).where(eq(importSessionItem.id, item.id)).run();
        tx.update(importSession).set({ failedCount: detail.session.failedCount + 1, updatedAt: new Date() }).where(eq(importSession.id, session.id)).run();
      });
    }
  }
  return session.id;
}
