import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { initializeLocalStore } from "../src/storage/database";
import { createLocalDraft, listLocalDrafts } from "../src/drafts/store";
import { getRawMockDatabase } from "../../tests/mocks/expo-sqlite";
import { parseLivePhotoPickerReceipt, type LivePhotoPickerReceipt } from "../src/native/picker-receipt";
import { recoverLivePhotoDraft } from "../src/native/live-photo-recovery";
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
const root = "file:///private/captures";
beforeEach(async () => { await initializeLocalStore(); getRawMockDatabase().exec("DELETE FROM local_draft; DELETE FROM local_capture"); });
async function fixture() {
  const scope = JSON.stringify(["https://fixture.invalid", "instance", "account-a", "family"]);
  const draft = await createLocalDraft(scope, randomUUID(), randomUUID());
  const originals = (["image", "video"] as const).map(role => {
    const id = randomUUID(), ext = role === "image" ? "heic" : "mov";
    return { id, itemId: randomUUID(), role, payload: { localUri: `${root}/${id}.${ext}`, fileName: `original.${ext}`, mimeType: role === "image" ? "image/heic" : "video/quicktime", mediaType: role, lastModified: null, source: "library" as const } };
  });
  const receipt: LivePhotoPickerReceipt = { version: 2, captureId: originals[0]!.id, scope, draftId: draft.id, expectedRevision: draft.revision, createdAt: new Date().toISOString(), originals };
  return { draft, receipt };
}
it("recovers both renamed originals atomically after termination before SQLite commit, with stable replay", async () => {
  const { draft, receipt } = await fixture();
  expect(parseLivePhotoPickerReceipt(JSON.parse(JSON.stringify(receipt)), root)).toEqual(receipt);
  await recoverLivePhotoDraft(receipt, () => true);
  const recovered = (await listLocalDrafts(draft.scope))[0]!;
  expect(recovered).toMatchObject({ id: draft.id, status: "editing", content: { items: receipt.originals.map(o => ({ localCaptureRef: o.id, livePhotoRole: o.role, livePhotoGroupId: receipt.captureId })) } });
  expect(getRawMockDatabase().prepare("SELECT count(*) n FROM local_capture").get()).toEqual({ n: 2 });
  await initializeLocalStore();
  await recoverLivePhotoDraft(receipt, () => true);
  expect(await listLocalDrafts(draft.scope)).toEqual([recovered]);
  expect(await listLocalDrafts("new-account")).toEqual([]);
  expect(getRawMockDatabase().prepare("SELECT count(*) n FROM outbox").get()).toEqual({ n: 0 });
});
it("retains the successful half with a missing component placeholder, and never auto-queues it", async () => {
  const { draft, receipt } = await fixture();
  await recoverLivePhotoDraft(receipt, uri => uri.endsWith(".heic"));
  const recovered = (await listLocalDrafts(draft.scope))[0]!;
  expect(recovered.status).toBe("editing");
  expect(recovered.content.items).toHaveLength(2);
  expect(recovered.content.items[1]).toMatchObject({ livePhotoRole: "video", assetId: null, localCaptureRef: null, preservationState: "missing" });
  expect(getRawMockDatabase().prepare("SELECT count(*) n FROM local_capture").get()).toEqual({ n: 1 });
});
it("rolls back both captures if SQLite fails on the second component, and recovers on retry", async () => {
  const { draft, receipt } = await fixture(), db = getRawMockDatabase();
  db.exec("CREATE TRIGGER fail_live_photo BEFORE INSERT ON local_capture WHEN NEW.media_type='video' BEGIN SELECT RAISE(ABORT, 'disk full'); END");
  await expect(recoverLivePhotoDraft(receipt, () => true)).rejects.toThrow("disk full");
  expect(await listLocalDrafts(draft.scope)).toEqual([draft]);
  expect(db.prepare("SELECT count(*) n FROM local_capture").get()).toEqual({ n: 0 });
  db.exec("DROP TRIGGER fail_live_photo");
  await recoverLivePhotoDraft(receipt, () => true);
  expect((await listLocalDrafts(draft.scope))[0]?.content.items).toHaveLength(2);
});
it("keeps changed or closed destinations separate and rejects an escaped path or substituted component", async () => {
  const { draft, receipt } = await fixture(), db = getRawMockDatabase();
  db.prepare("UPDATE local_draft SET snapshot_json=? WHERE id=?").run(JSON.stringify({ ...draft, status: "discarded", revision: 2 }), draft.id);
  await recoverLivePhotoDraft(receipt, () => true);
  const rows = await listLocalDrafts(draft.scope);
  expect(rows.find(d => d.id === draft.id)?.status).toBe("discarded");
  expect(rows.find(d => d.id !== draft.id)).toMatchObject({ status: "editing", content: { visibility: "private" } });
  for (const change of [{ localUri: "file:///private/secret" }, { mediaType: "image" }, { source: "files" }]) {
    expect(parseLivePhotoPickerReceipt({ ...receipt, originals: receipt.originals.map((o,n) => n ? { ...o, payload: { ...o.payload, ...change } } : o) }, root)).toBeNull();
  }
});
it("recovers a pair into a separate private draft when the original draft has no room", async () => {
  const { draft, receipt } = await fixture(), db = getRawMockDatabase();
  const full = { ...draft, content: { ...draft.content, items: Array.from({ length: 199 }, (_, n) => ({ id: `existing-${n}`, assetId: `asset-${n}`, localCaptureRef: null, caption: "" })) } };
  db.prepare("UPDATE local_draft SET snapshot_json=? WHERE id=?").run(JSON.stringify(full), draft.id);
  await recoverLivePhotoDraft(receipt, () => true);
  const rows = await listLocalDrafts(draft.scope);
  expect(rows.find(d => d.id === draft.id)).toEqual(full);
  expect(rows.find(d => d.id !== draft.id)).toMatchObject({ status: "editing", content: { visibility: "private", items: receipt.originals.map(o => ({ livePhotoRole: o.role })) } });
  await recoverLivePhotoDraft(receipt, () => true);
  expect(await listLocalDrafts(draft.scope)).toHaveLength(2);
});
