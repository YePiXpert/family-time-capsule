import { describe, expect, it } from "vitest";
import { recoverPickerReceipt, type PickerReceipt } from "../src/native/picker-receipt";

const root = "file:///private/documents/captures/";
const receipt: PickerReceipt = {
  sessionId: "10000000-0000-4000-8000-000000000001",
  captureId: "20000000-0000-4000-8000-000000000001",
  createdAt: "2026-09-04T12:00:00.000Z",
  index: 3,
  payload: {
    localUri: `${root}20000000-0000-4000-8000-000000000001.pdf`,
    fileName: "家庭来信.pdf", mimeType: "application/pdf", mediaType: "document",
    lastModified: null, source: "files",
  },
};

describe("Files intake crash recovery", () => {
  it("recovers a renamed original after termination before SQLite commit", () => {
    const recovered = recoverPickerReceipt(JSON.parse(JSON.stringify(receipt)), root, () => true);
    expect(recovered).toMatchObject({ id: receipt.sessionId, createdAt: receipt.createdAt, items: [{
      captureId: receipt.captureId, externalId: "picker-3", sortOrder: 3, kind: "file", payload: receipt.payload,
    }] });
  });

  it("does not mistake an unfinished temporary copy for an original", () => {
    expect(recoverPickerReceipt(receipt, root, () => false)?.items).toEqual([{
      captureId: receipt.captureId, externalId: "picker-3", sortOrder: 3,
      kind: "error", error: "copy_interrupted",
    }]);
  });

  it("keeps replay identifiers stable and never invents source time", () => {
    const first = recoverPickerReceipt(receipt, root, () => true);
    expect(recoverPickerReceipt(receipt, root, () => true)).toEqual(first);
    expect(first?.items[0]?.payload).toHaveProperty("lastModified", null);
    expect(recoverPickerReceipt({ ...receipt, payload: { ...receipt.payload, lastModified: Date.now() } }, root, () => true)).toBeNull();
  });

  it("rejects paths outside the capture, executable types and corrupt receipts", () => {
    for (const localUri of ["file:///private/token", `${root}${receipt.captureId}.pdf/../secret`, `${root}${receipt.captureId}.%2e%2e`, `${root}another.pdf`]) {
      expect(recoverPickerReceipt({ ...receipt, payload: { ...receipt.payload, localUri } }, root, () => true)).toBeNull();
    }
    expect(recoverPickerReceipt({ ...receipt, payload: { ...receipt.payload, fileName: "script.html", mimeType: "text/html" } }, root, () => true)).toBeNull();
    expect(recoverPickerReceipt({}, root, () => true)).toBeNull();
    expect(recoverPickerReceipt(null, root, () => true)).toBeNull();
  });
});
