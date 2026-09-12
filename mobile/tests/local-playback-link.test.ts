import { beforeEach, expect, it, vi } from "vitest";
import { getDatabase, getLocalCaptureDetail, initializeLocalStore, clearLocalArchive, listTimeline } from "../src/storage/database";
import { createLocalDraft, saveLocalDraft } from "../src/drafts/store";
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));

beforeEach(async () => { await initializeLocalStore(); await clearLocalArchive(); });

it("links an already uploaded local original only to the requested account's exact receipt", async () => {
  const draft = await createLocalDraft("family-a", "draft-a", "mutation-a");
  const saved = { ...draft, revision: 2, content: { ...draft.content, items: [
    { id: "video-item", localCaptureRef: "video", assetId: "asset-in-a", caption: "" },
  ] } };
  await saveLocalDraft(saved, 1, { id: "video", payload: {
    localUri: "file:///originals/video.mpg", fileName: "video.mpg", mimeType: "video/mpeg", mediaType: "video", source: "files", lastModified: null,
  } });
  const linked = await getLocalCaptureDetail("video", "family-a");
  expect(linked).toMatchObject({ captureId: "video", localUri: "file:///originals/video.mpg", remoteAssetId: "asset-in-a" });
  expect(await getLocalCaptureDetail("video", "family-b")).not.toHaveProperty("remoteAssetId");
  expect(await getLocalCaptureDetail("video")).not.toHaveProperty("remoteAssetId");
  // Malformed unrelated drafts must not prevent opening an intact local file.
  const db = await getDatabase();
  await db.runAsync("INSERT INTO local_draft (id,scope,snapshot_json,revision,updated_at) VALUES (?,?,?,?,?)", "damaged", "family-a", "not-json", 1, "2026-09-12");
  expect(await getLocalCaptureDetail("video", "family-a")).toEqual(linked);
  await db.runAsync("DELETE FROM local_draft WHERE id=? AND scope=?", "damaged", "family-a");
  await saveLocalDraft({ ...saved, revision: 3, content: { ...saved.content, items: [{ ...saved.content.items[0]!, assetId: null }] } }, 2);
  expect(await getLocalCaptureDetail("video", "family-a")).not.toHaveProperty("remoteAssetId");
});

it("loads many saved-draft covers in bounded reads and respects explicit cover ordering", async () => {
  for (let index = 0; index < 40; index++) {
    let draft = await createLocalDraft("local", `draft-${index}`, `mutation-${index}`);
    for (const mediaType of ["image", "audio", "image"] as const) {
      const id = `capture-${index}-${draft.revision}`;
      const next = { ...draft, revision: draft.revision + 1, content: { ...draft.content, items: [
        ...draft.content.items, { id, localCaptureRef: id, assetId: null, caption: "" },
      ] } };
      await saveLocalDraft(next, draft.revision, { id, payload: {
        localUri: `file:///originals/${id}`, fileName: id, mimeType: mediaType === "image" ? "image/jpeg" : "audio/wav", mediaType, source: "files", lastModified: null,
      } });
      draft = next;
    }
    await saveLocalDraft({ ...draft, revision: draft.revision + 1, status: "queued", content: { ...draft.content, coverItemId: draft.content.items[2]!.id } }, draft.revision);
  }
  const db = await getDatabase();
  const first = vi.spyOn(db, "getFirstAsync");
  const all = vi.spyOn(db, "getAllAsync");
  const rows = await listTimeline(null, "local");
  expect(rows).toHaveLength(40);
  for (const row of rows) {
    const index = row.localDraftId!.split("-")[1];
    expect(row.localCoverUri).toBe(`file:///originals/capture-${index}-3`);
  }
  // The number of bridge reads does not grow with the number of draft assets.
  expect(first.mock.calls.length + all.mock.calls.length).toBeLessThanOrEqual(4);
  first.mockRestore(); all.mockRestore();
});
