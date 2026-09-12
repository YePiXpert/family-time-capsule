import { beforeEach, expect, it, vi } from "vitest";
import { initializeLocalStore, clearLocalArchive, ingestLocalImportSession, getLocalCaptureDetail } from "../src/storage/database";
import { chooseLocalIntake, getLocalIntake } from "../src/native/intake-store";
import { createLocalDraft, listLocalDrafts, saveLocalDraft } from "../src/drafts/store";
import { pairDraftItems } from "../src/drafts/model";
import { getRawMockDatabase } from "../../tests/mocks/expo-sqlite";
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
const scope = '["https://fixture.invalid","instance","user-a","family"]';
const media = (id: string, mediaType: "image" | "video" = "image") => ({ externalId: id, captureId: id, kind: "file" as const, payload: { localUri: `file:///private/${id}.${mediaType === "image" ? "jpg" : "mov"}`, fileName: id, mimeType: mediaType === "image" ? "image/jpeg" : "video/quicktime", mediaType, lastModified: null, source: "files" as const } });
async function batch() {
  await ingestLocalImportSession({ id: "batch", scope, source: "files", createdAt: "2026-09-12T12:00:00Z", queue: false, items: [media("a"), media("b"), media("video", "video"), { externalId: "text", captureId: "text", kind: "text", payload: { text: "当时的原话" } }] });
}
const choose = (extra: Partial<Parameters<typeof chooseLocalIntake>[0]> = {}) => chooseLocalIntake({ id: "batch", scope, expectedRevision: 0, destination: "draft", draftId: "draft", draftRevision: 0, mutationId: "join", ...extra });
beforeEach(async () => { await initializeLocalStore(); await clearLocalArchive(); await batch(); });

it("joins only selected originals and text, retains every source, and replays one draft choice without duplication", async () => {
  const input = { selectedCaptureIds: ["b", "text"], coverCaptureId: "b" };
  await choose(input);
  const draft = (await listLocalDrafts(scope))[0]!;
  expect(draft.content.text).toBe("当时的原话");
  expect(draft.content.items.map(item => item.localCaptureRef)).toEqual(["b"]);
  expect(draft.content.coverItemId).toBe("b");
  expect(draft.status).toBe("editing");
  await choose(input);
  expect((await listLocalDrafts(scope))[0]).toEqual(draft);
  for (const id of ["a", "b", "video", "text"]) expect(await getLocalCaptureDetail(id)).not.toBeNull();
  expect(getRawMockDatabase().prepare("SELECT COUNT(*) n FROM outbox").get()).toEqual({ n: 0 });
});

it("rejects invalid selections and covers without changing either destination or draft", async () => {
  for (const input of [{ selectedCaptureIds: ["not-in-batch"] }, { selectedCaptureIds: ["a", "a"] }, { selectedCaptureIds: [] }, { selectedCaptureIds: ["a"], coverCaptureId: "b" }, { selectedCaptureIds: ["video"], coverCaptureId: "video" }]) {
    await expect(choose(input)).rejects.toThrow();
    expect(await listLocalDrafts(scope)).toEqual([]);
    expect((await getLocalIntake("batch", scope))?.choice).toMatchObject({ destination: "pending", revision: 0 });
  }
});

it("refines only this batch's media, preserves written text and outside originals, and checks revisions", async () => {
  await ingestLocalImportSession({ id: "outside-batch", source: "files", scope, queue: false, createdAt: "2026-09-12T10:00:00Z", items: [media("outside")] });
  const original = await createLocalDraft(scope, "draft", "original");
  await saveLocalDraft({ ...original, revision: 2, content: { ...original.content, text: "先前的正文", items: [{ id: "outside-item", localCaptureRef: "outside", assetId: null, caption: "保留此说明" }], coverItemId: "outside-item" } }, 1);
  await choose({ draftRevision: 2, selectedCaptureIds: ["a", "text"], coverCaptureId: "a" });
  const before = (await listLocalDrafts(scope))[0]!;
  await choose({ expectedRevision: 1, draftRevision: before.revision, selectedCaptureIds: ["b", "text"], coverCaptureId: "b", refine: true, mutationId: "refine" });
  const after = (await listLocalDrafts(scope))[0]!;
  expect(after.content.text).toBe("先前的正文\n\n当时的原话");
  expect(after.content.items).toEqual([{ id: "outside-item", localCaptureRef: "outside", assetId: null, caption: "保留此说明" }, { id: "b", localCaptureRef: "b", assetId: null, caption: "" }]);
  await expect(choose({ expectedRevision: 1, draftRevision: after.revision, selectedCaptureIds: ["a"], refine: true })).rejects.toThrow("另一处更新");
  await expect(choose({ expectedRevision: 2, draftRevision: before.revision, selectedCaptureIds: ["a"], refine: true })).rejects.toThrow("草稿已修改");
  expect((await listLocalDrafts(scope))[0]).toEqual(after);
  expect((await getLocalCaptureDetail("a"))?.localUri).toBe("file:///private/a.jpg");
});

it("refining this batch without a chosen cover preserves a cover belonging to another source", async () => {
  await choose({ selectedCaptureIds: ["a"], coverCaptureId: "a" });
  await ingestLocalImportSession({ id: "outside-batch", source: "files", scope, queue: false, createdAt: "2026-09-12T10:00:00Z", items: [media("outside")] });
  const current = (await listLocalDrafts(scope))[0]!;
  await saveLocalDraft({ ...current, revision: current.revision + 1, content: { ...current.content, coverItemId: "outside-item", items: [...current.content.items, { id: "outside-item", localCaptureRef: "outside", assetId: null, caption: "" }] } }, current.revision);
  await choose({ expectedRevision: 1, draftRevision: current.revision + 1, selectedCaptureIds: ["b"], coverCaptureId: null, refine: true });
  expect((await listLocalDrafts(scope))[0]?.content.coverItemId).toBe("outside-item");
});

it("refusing a half Live Photo is atomic, while removing the whole pair leaves both originals intact", async () => {
  await choose({ selectedCaptureIds: ["a", "video"], coverCaptureId: "a" });
  const current = (await listLocalDrafts(scope))[0]!;
  const paired = { ...current, revision: current.revision + 1, content: { ...current.content, ...pairDraftItems(current.content, "a", "video", "live-pair") } };
  await saveLocalDraft(paired, current.revision);
  await expect(choose({ expectedRevision: 1, draftRevision: paired.revision, selectedCaptureIds: ["a"], refine: true })).rejects.toThrow("Live Photo");
  expect((await listLocalDrafts(scope))[0]).toEqual(paired);
  expect((await getLocalIntake("batch", scope))?.choice.revision).toBe(1);
  await choose({ expectedRevision: 1, draftRevision: paired.revision, selectedCaptureIds: [], coverCaptureId: null, refine: true });
  expect((await listLocalDrafts(scope))[0]?.content.items).toEqual([]);
  expect(await getLocalCaptureDetail("a")).not.toBeNull();
  expect(await getLocalCaptureDetail("video")).not.toBeNull();
});

it("local-library preservation queues nothing; later explicit upload queues all originals and recovers after restart", async () => {
  await choose({ destination: "library", draftId: undefined, queueUpload: false, selectedCaptureIds: ["a"] });
  const db = getRawMockDatabase();
  expect(db.prepare("SELECT COUNT(*) n FROM outbox").get()).toEqual({ n: 0 });
  const input = { destination: "library" as const, draftId: undefined, expectedRevision: 1, queueUpload: true, mutationId: "upload-all" };
  expect((await choose(input)).uploadIds.sort()).toEqual(["a", "b", "video"]);
  await initializeLocalStore();
  expect((await choose(input)).uploadIds.sort()).toEqual(["a", "b", "video"]);
  expect((await getLocalIntake("batch", scope))?.choice.revision).toBe(2);
  expect(db.prepare("SELECT COUNT(*) n FROM local_capture").get()).toEqual({ n: 4 });
  expect(await listLocalDrafts(scope)).toEqual([]);
});

it("can curate a library-only batch later and never transfer family-owned originals to another account", async () => {
  await choose({ destination: "library", draftId: undefined, queueUpload: false });
  await expect(choose({ scope: "other-account", expectedRevision: 1, selectedCaptureIds: ["a"] })).rejects.toThrow("其他账号或家庭");
  await choose({ expectedRevision: 1, selectedCaptureIds: ["b"], coverCaptureId: "b" });
  expect((await listLocalDrafts(scope))[0]?.content.items.map(item => item.localCaptureRef)).toEqual(["b"]);
  expect(getRawMockDatabase().prepare("SELECT COUNT(*) n FROM outbox").get()).toEqual({ n: 0 });
});
