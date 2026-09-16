import { beforeEach, expect, it, vi } from "vitest";
import type { LocalMemoryEdit } from "../src/memories/edit-model";
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
const db = await import("../src/storage/database");
const { getRawMockDatabase } = await import("../../tests/mocks/expo-sqlite");
const scope = JSON.stringify(["https://family.invalid", "instance", "owner", "family"]);
const content = { title: "海边", bodyText: "新的补记", location: "", occurredAt: "2026-09-16T00:00:00Z", precision: "exact" as const, participants: [], child: null, items: [{ id: "item", localCaptureRef: "photo", assetId: null, caption: "" }] };
function snapshot(): LocalMemoryEdit {
  return { scope, memoryId: "memory", content: { ...content, items: [] }, base: { ...content, items: [] }, baseRevision: 3, timezone: "UTC", savedContent: null,
    submission: { mutationId: "mutation", content, expectedRevision: 3 }, conflict: null, blocked: false, problem: null, revision: 2, updatedAt: "2026-09-16T00:00:00Z" };
}
function original(owner = true, archived = false) {
  const payload = { localUri: "file:///private-photo.jpg", fileName: "photo.jpg", mimeType: "image/jpeg", mediaType: "image", source: "library", lastModified: null,
    ...(owner ? { memoryEditOwnerScope: scope, memoryEditTarget: "memory" } : {}) };
  getRawMockDatabase().prepare("INSERT INTO local_capture(id,kind,title,occurred_at,local_uri,media_type,payload_json,sync_state,memory_event_id) VALUES('photo','media_capture','photo','2026-09-16T00:00:00Z',?,'image',?,?,?)")
    .run(payload.localUri, JSON.stringify(payload), archived ? "archived" : "pending", archived ? "memory" : null);
}
function edit() { const row = snapshot(); getRawMockDatabase().prepare("INSERT INTO local_memory_edit(scope,memory_id,snapshot_json,updated_at) VALUES(?,?,?,?)").run(scope, row.memoryId, JSON.stringify(row), row.updatedAt); }
beforeEach(async () => {
  await db.initializeLocalStore();
  getRawMockDatabase().exec("DELETE FROM local_capture; DELETE FROM local_draft; DELETE FROM local_memory_edit; DELETE FROM local_album; DELETE FROM local_work_session; DELETE FROM outbox;");
});
it("keeps in-flight originals out of the timeline and ordinary rescue even when only submission references remain", async () => {
  original(false); edit();
  expect(await db.listTimeline(null)).toEqual([]);
  expect(await db.listPendingRescueItems()).toEqual([]);
  await expect(db.deleteLocalCaptureRecord("photo")).rejects.toThrow("引用");
  await expect(db.removeLocalCaptureRecord("photo")).rejects.toThrow("引用");
  expect((await db.listMemoryEditRescueGroups())[0]).toMatchObject({ scope, memoryId: "memory", originals: [{ id: "photo" }] });
});
it("protects album originals after a draft is published, until the album releases its reference", async () => {
  original(false);
  const raw = getRawMockDatabase();
  raw.prepare("INSERT INTO local_draft(scope,id,snapshot_json,revision,updated_at) VALUES(?,?,?,?,?)").run("local", "draft", JSON.stringify({ status: "published", content }), 1, "now");
  raw.prepare("INSERT INTO local_album(scope,id,snapshot_json,revision,updated_at) VALUES(?,?,?,?,?)").run("local", "album", JSON.stringify({ items: [{ ref: { kind: "localDraft", scope: "local", id: "draft" } }] }), 1, "now");
  await expect(db.deleteLocalCaptureRecord("photo")).rejects.toThrow("引用");
  raw.exec("DELETE FROM local_album");
  await db.deleteLocalCaptureRecord("photo");
  expect(await db.captureRecordExists("photo")).toBe(false);
});
it("retains original owner isolation after a completed edit snapshot is removed", async () => {
  original(true, true);
  expect(await db.listLocalMemoryMedia("memory", scope)).toHaveLength(1);
  expect(await db.listLocalMemoryMedia("memory", "local")).toEqual([]);
  expect(await db.listLocalMemoryMedia("memory", "other-account")).toEqual([]);
});
it("restores private edits atomically into the same target with sync blocked and no standalone upload", async () => {
  original(); edit();
  const groups = await db.listMemoryEditRescueGroups();
  await db.clearLocalArchive();
  expect(await db.restoreMemoryEditRescueGroup(groups[0]!)).toBe(true);
  expect(await db.restoreMemoryEditRescueGroup(groups[0]!)).toBe(false);
  const restored = (await db.listMemoryEditRescueGroups())[0]!;
  expect(restored.snapshot.blocked).toBe(true);
  expect(restored.snapshot.submission?.mutationId).toBe("mutation");
  expect(getRawMockDatabase().prepare("SELECT * FROM outbox").all()).toEqual([]);
  expect(await db.listPendingRescueItems()).toEqual([]);
  expect(await db.listTimeline(null)).toEqual([]);
});
it("does not steal an existing original from another record during rescue", async () => {
  original(); edit();
  const group = (await db.listMemoryEditRescueGroups())[0]!;
  getRawMockDatabase().exec("DELETE FROM local_memory_edit");
  getRawMockDatabase().prepare("UPDATE local_capture SET payload_json=? WHERE id='photo'").run(JSON.stringify({ memoryEditOwnerScope: "another-owner", memoryEditTarget: "elsewhere" }));
  await expect(db.restoreMemoryEditRescueGroup(group)).rejects.toThrow("另一条记录");
  expect(await db.listMemoryEditRescueGroups()).toEqual([]);
});
