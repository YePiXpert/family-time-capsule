import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createPhotoSelection, reconcilePhotoSelection, type ImportPickItem } from "../src/imports/photo-selection";
import { loadPhotoSelection, savePhotoSelection, drainPhotoSelectionWrites, PhotoSelectionConflictError } from "../src/imports/photo-selection-store";
import { initializeLocalStore, clearLocalArchive, ingestLocalImportSession } from "../src/storage/database";
import { getRawMockDatabase } from "../../tests/mocks/expo-sqlite";
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
const photo = (id: string, capturedAt: string | null = null): ImportPickItem => ({ id, title: id + ".jpg", type: "image", capturedAt });
const scope = '["https://fixture.invalid","instance","user-a","family"]';
let directory: string | undefined;
beforeEach(async () => { await drainPhotoSelectionWrites(); await initializeLocalStore(); await clearLocalArchive(); });
afterEach(async () => { await drainPhotoSelectionWrites(); if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

it("groups only photos with reliable instants in a 30 second window anchored to the first photo", () => {
  const items = [photo("a", "2026-09-12T12:00:00Z"), photo("b", "2026-09-12T20:00:30+08:00"), photo("c", "2026-09-12T12:00:31Z"), photo("d", "2026-09-12T12:00:59Z"), photo("date-only", "2026-09-12"), photo("naive", "2026-09-12T12:00:00"), photo("impossible", "2026-02-30T12:00:00Z"), photo("unknown"), { id: "video", title: "video", type: "video" as const, capturedAt: "2026-09-12T12:00:00Z" }];
  const value = createPhotoSelection(items);
  expect(value.groups.filter(group => group.reason === "time").map(group => group.ids)).toEqual([["a", "b"], ["c", "d"]]);
  expect(value.groups.find(group => group.reason === "batch")?.ids).toEqual(["date-only", "naive", "impossible", "unknown", "video"]);
  expect(value.selectedIds).toEqual(items.map(item => item.id));
  expect(value.coverId).toBe("a");
  expect(value.groups.flatMap(group => group.ids)).toHaveLength(items.length);
});

it("retains deselection and manual boundaries on refresh while adding new originals and clearing invalid covers", () => {
  const items = [photo("a"), photo("b"), photo("c")];
  const value = { ...createPhotoSelection(items), selectedIds: ["a", "c"], coverId: "c", groups: [{ id: "manual", ids: ["a", "b"], representativeId: "b", reason: "manual" as const }, { id: "single", ids: ["c"], representativeId: "c", reason: "manual" as const }] };
  const refreshed = reconcilePhotoSelection(value, [photo("a"), photo("b"), photo("new")]);
  expect(refreshed.selectedIds).toEqual(["a", "new"]);
  expect(refreshed.coverId).toBeNull();
  expect(refreshed.groups[0]).toEqual(value.groups[0]);
  expect(refreshed.groups.flatMap(group => group.ids)).toEqual(["a", "b", "new"]);
  expect(reconcilePhotoSelection({ ...value, selectedIds: ["a"] }, items).coverId).toBeNull();
  expect(value.selectedIds).toEqual(["a", "c"]);
});

it("never treats an edited metadata time as evidence for an obsolete suggested time group", () => {
  const items = [photo("a", "2026-09-12T12:00:00Z"), photo("b", "2026-09-12T12:00:05Z")];
  const value = createPhotoSelection(items);
  expect(reconcilePhotoSelection(value, [items[0]!, photo("b", null)]).groups[0]?.reason).toBe("batch");
  expect(() => createPhotoSelection([photo("same"), photo("same")])).toThrow("重复");
});

it("persists selection in real SQLite, isolates account/instance scopes and does not modify original bytes", async () => {
  directory = await mkdtemp(join(tmpdir(), "ftc-selection-"));
  const original = join(directory, "original.jpg");
  const bytes = Buffer.from("Synthetic immutable original fixture");
  await writeFile(original, bytes);
  await ingestLocalImportSession({ id: "receipt", source: "files", scope, queue: false, createdAt: "2026-09-12T12:00:00Z", items: [{ externalId: "photo", captureId: "a", kind: "file", payload: { localUri: pathToFileURL(original).href, fileName: "original.jpg", mimeType: "image/jpeg", mediaType: "image", lastModified: null, source: "files" } }] });
  const input = { ...createPhotoSelection([photo("a")]), selectedIds: [], coverId: null };
  const saved = await savePhotoSelection(scope, "receipt", input, 0);
  await initializeLocalStore();
  expect(await loadPhotoSelection(scope, "receipt")).toEqual(saved);
  expect(saved.revision).toBe(1);
  for (const other of ["local", '["https://fixture.invalid","instance","user-b","family"]', '["https://fixture.invalid","other","user-a","family"]', '["https://fixture.invalid","instance","user-a","other-family"]']) expect(await loadPhotoSelection(other, "receipt")).toBeNull();
  expect(await readFile(original)).toEqual(bytes);
  expect(getRawMockDatabase().prepare("SELECT COUNT(*) n FROM local_capture WHERE id='a'").get()).toEqual({ n: 1 });
  expect(getRawMockDatabase().prepare("SELECT COUNT(*) n FROM outbox").get()).toEqual({ n: 0 });
});

it("CAS accepts one concurrent writer and snapshots input before a caller mutates it", async () => {
  const first = createPhotoSelection([photo("a"), photo("b")]);
  const second = { ...first, selectedIds: ["b"], coverId: "b" };
  const writes = [savePhotoSelection(scope, "receipt", first, 0), savePhotoSelection(scope, "receipt", second, 0)];
  first.selectedIds.pop();
  first.groups[0]!.ids.pop();
  const results = await Promise.allSettled(writes);
  expect(results[0]!.status).toBe("fulfilled");
  expect(results[1]).toMatchObject({ status: "rejected", reason: expect.any(PhotoSelectionConflictError) });
  const saved = (await loadPhotoSelection(scope, "receipt"))!;
  expect(saved.selectedIds).toEqual(["a", "b"]);
  expect(saved.groups[0]!.ids).toEqual(["a", "b"]);
  await expect(savePhotoSelection(scope, "receipt", { ...saved, revision: 0 }, saved.revision)).rejects.toThrow("版本");
  expect(await loadPhotoSelection(scope, "receipt")).toEqual(saved);
});

it("a failed transaction and malformed recovery never replace the previous saved choice", async () => {
  const saved = await savePhotoSelection(scope, "receipt", createPhotoSelection([photo("a"), photo("b")]), 0);
  const db = getRawMockDatabase();
  db.exec("CREATE TRIGGER fail_selection BEFORE UPDATE ON local_import_selection BEGIN SELECT RAISE(ABORT,'disk full'); END");
  await expect(savePhotoSelection(scope, "receipt", { ...saved, selectedIds: ["b"], coverId: "b" }, saved.revision)).rejects.toThrow("disk full");
  db.exec("DROP TRIGGER fail_selection");
  expect(await loadPhotoSelection(scope, "receipt")).toEqual(saved);
  await expect(savePhotoSelection(scope, "receipt", { ...saved, groups: [saved.groups[0]!, saved.groups[0]!] }, 1)).rejects.toThrow("分组");
  expect(await loadPhotoSelection(scope, "receipt")).toEqual(saved);
  db.prepare("UPDATE local_import_selection SET snapshot_json='broken' WHERE scope=? AND session_id='receipt'").run(scope);
  await expect(loadPhotoSelection(scope, "receipt")).rejects.toThrow("读取");
  expect(db.prepare("SELECT snapshot_json FROM local_import_selection WHERE scope=?").get(scope)).toEqual({ snapshot_json: "broken" });
});
