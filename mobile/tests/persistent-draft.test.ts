import { expect, it, vi } from "vitest";
import { initializeLocalStore, getLocalCaptureDetail, clearServerCaches, setActiveDestination, listTimeline, removeLocalCaptureRecord } from "../src/storage/database";
import { canUploadDraftOriginal, createLocalDraft, listLocalDrafts, queueDraftOriginals, saveLocalDraft } from "../src/drafts/store";
import { mergeSavedDrafts } from "../src/storage/local-timeline";
import { timelineRecordKey } from "../src/navigation/records";
import { getRawMockDatabase } from "../../tests/mocks/expo-sqlite";
import type { MediaCapturePayload } from "../src/types";
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
it("retains a mixed draft across reinitialization without copying originals, with ordering, failed writes, and scope isolation", async () => {
  await initializeLocalStore();
  const scope = JSON.stringify(["https://fixture.invalid", "instance", "account", "family"]);
  await setActiveDestination(scope);
  let row = await createLocalDraft(scope, "draft-a", "mutation-a");
  row = { ...row, content: { ...row.content, text: "外公讲年轻时候的故事", occurredAt: "1980-08-12T09:30:00.000Z" }, revision: 2 };
  await saveLocalDraft(row, 1);
  const payload = (id: string, type: "image" | "audio"): MediaCapturePayload => ({ localUri: `file:///originals/${id}`, fileName: `${id}.${type === "audio" ? "wav" : "jpg"}`, mimeType: type === "audio" ? "audio/wav" : "image/jpeg", mediaType: type, lastModified: null, source: "library" });
  for (const [id, type] of [["photo-1", "image"], ["photo-2", "image"], ["audio", "audio"]] as const) {
    const next = { ...row, revision: row.revision + 1, content: { ...row.content, items: [...row.content.items, { id: `item-${id}`, assetId: null, localCaptureRef: id, caption: "" }] } };
    await saveLocalDraft(next, row.revision, { id, payload: payload(id, type) }); row = next;
  }
  const db = getRawMockDatabase();
  expect(db.prepare("SELECT count(*) n FROM outbox").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT count(*) n FROM local_capture").get()).toEqual({ n: 3 });
  await initializeLocalStore();
  expect(await listLocalDrafts(scope)).toEqual([row]);
  const reordered = { ...row, revision: row.revision + 1, content: { ...row.content, items: [...row.content.items].reverse(), coverItemId: "item-photo-2" } };
  await saveLocalDraft(reordered, row.revision);
  await expect(saveLocalDraft(row, row.revision)).rejects.toThrow("另一处修改");
  const failing = { ...reordered, revision: reordered.revision + 1, content: { ...reordered.content, text: "磁盘失败时不应替换旧内容" } };
  db.exec("CREATE TRIGGER fail_draft BEFORE UPDATE ON local_draft BEGIN SELECT RAISE(ABORT, 'disk full'); END");
  await expect(saveLocalDraft(failing, reordered.revision)).rejects.toThrow("disk full");
  db.exec("DROP TRIGGER fail_draft");
  expect(await listLocalDrafts(scope)).toEqual([reordered]);
  expect(await listLocalDrafts("different-account-family")).toEqual([]);
  await clearServerCaches();
  expect(await listLocalDrafts(scope)).toEqual([reordered]);
  expect((await getLocalCaptureDetail("audio"))?.localUri).toBe("file:///originals/audio");
  await queueDraftOriginals(reordered);
  await queueDraftOriginals(reordered);
  expect(db.prepare("SELECT count(*) n FROM outbox").get()).toEqual({ n: 0 });
  const discarded = { ...reordered, revision: reordered.revision + 1, status: "discarded" as const };
  await saveLocalDraft(discarded, reordered.revision);
  expect(db.prepare("SELECT count(*) n FROM local_capture").get()).toEqual({ n: 3 });
});

it("shows a saved offline video bundle as one record after restart, scoped to its owner", async () => {
  await initializeLocalStore();
  const scope = "saved-video-owner";
  let draft = await createLocalDraft(scope, "video-draft", "video-mutation");
  draft = { ...draft, revision: 2, content: { ...draft.content, text: "小美第一次回家", items: [{ id: "video-item", assetId: null, localCaptureRef: "saved-video", caption: "回家的路上" }] } };
  await saveLocalDraft(draft, 1, { id: "saved-video", payload: { localUri: "file:///originals/home.mov", fileName: "home.mov", mimeType: "video/quicktime", mediaType: "video", lastModified: null, source: "library" } });
  expect((await listTimeline(null, scope)).some(item => item.localDraftId === draft.id)).toBe(false);
  draft = { ...draft, status: "queued", syncIntent: "publish", revision: 3 };
  await saveLocalDraft(draft, 2);
  await initializeLocalStore();
  const entries = (await listTimeline(null, scope)).filter(item => item.localDraftId === draft.id);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ title: "小美第一次回家", assetCount: 1, occurredAtPrecision: "unknown", captureIds: ["saved-video"] });
  expect((await getLocalCaptureDetail("saved-video"))?.localUri).toBe("file:///originals/home.mov");
  expect((await listTimeline(null, "other-owner")).some(item => item.localDraftId === draft.id)).toBe(false);
  await saveLocalDraft({ ...draft, status: "published", memoryEventId: "published-video", revision: 4 }, 3);
  // A removed server record must not be resurrected by an old published draft.
  expect((await listTimeline(null, scope)).some(item => item.localDraftId === draft.id)).toBe(false);
});

it("keeps the saved story and its original protected while an unfinished edit removes them", async () => {
  await initializeLocalStore();
  const scope = "reading-snapshot-owner";
  const draft = await createLocalDraft(scope, "snapshot-draft", "snapshot-mutation");
  const saved = { ...draft, revision: 2, status: "queued" as const, content: { ...draft.content, title: "第一次看海", text: "已保存的完整故事", coverItemId: "snapshot-item", items: [{ id: "snapshot-item", localCaptureRef: "snapshot-photo", assetId: "receipt-photo", caption: "" }] } };
  await saveLocalDraft(saved, 1, { id: "snapshot-photo", payload: { localUri: "file:///sea.jpg", fileName: "sea.jpg", mediaType: "image", mimeType: "image/jpeg", source: "library", lastModified: null } });
  const editing = { ...saved, revision: 3, savedContent: saved.content, status: "editing" as const, content: { ...saved.content, title: "未完成标题", text: "未完成文字", items: [], coverItemId: null } };
  await saveLocalDraft(editing, 2);
  await initializeLocalStore();
  const timeline = await listTimeline(null, scope);
  const record = timeline.find(item => item.localDraftId === draft.id)!;
  expect(record).toMatchObject({ title: "第一次看海", bodyText: "已保存的完整故事", localCoverUri: "file:///sea.jpg", assetCount: 1, hasUnsavedChanges: true });
  expect(timeline.some(item => item.id === "local:snapshot-photo")).toBe(false);
  expect((await getLocalCaptureDetail("snapshot-photo", scope))?.remoteAssetId).toBe("receipt-photo");
  expect((await getLocalCaptureDetail("snapshot-photo", "another-owner"))?.remoteAssetId).toBeUndefined();
  expect(await canUploadDraftOriginal("snapshot-photo", "another-owner")).toBe(false);
  await expect(removeLocalCaptureRecord("snapshot-photo")).rejects.toThrow();
  const published = { ...saved, status: "published" as const, memoryEventId: "server-snapshot", revision: 4 };
  const remote = { ...record, id: "server-snapshot", source: "server" as const, localDraftId: undefined };
  const merged = mergeSavedDrafts([remote], [published]);
  expect(merged).toHaveLength(1);
  expect(timelineRecordKey(merged[0]!)).toBe(timelineRecordKey(record));
  expect(mergeSavedDrafts([], [published])).toEqual([]);
});
