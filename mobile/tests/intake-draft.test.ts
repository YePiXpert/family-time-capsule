import { expect, it, vi } from "vitest";
import { initializeLocalStore, ingestLocalImportSession, getLocalCaptureDetail } from "../src/storage/database";
import { createLocalDraft, listLocalDrafts, saveLocalDraft } from "../src/drafts/store";
import { getRawMockDatabase } from "../../tests/mocks/expo-sqlite";
import type { MediaCapturePayload } from "../src/types";
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
it("preserves a Files receipt without uploading, joins its original to one draft and resumes after restart", async () => {
  await initializeLocalStore();
  const payload: MediaCapturePayload = { localUri: "file:///private/captures/files-photo.jpg", fileName: "外公旧照片.jpg", mimeType: "image/jpeg", mediaType: "image", lastModified: null, source: "files" };
  const input = { id: "intake-files", source: "files" as const, createdAt: "2026-09-07T00:00:00Z", queue: false, items: [{ externalId: "picker-0", captureId: "files-photo", kind: "file" as const, payload, localUri: payload.localUri }] };
  expect(await ingestLocalImportSession(input)).toEqual({ queued: 0, failed: 0 });
  expect((await getLocalCaptureDetail("files-photo"))?.localUri).toBe(payload.localUri);
  const draft = await createLocalDraft("local", "intake-draft", "intake-new");
  const saved = { ...draft, revision: 2, content: { ...draft.content, text: "外公年轻时的一张照片", items: [{ id: "photo-item", assetId: null, localCaptureRef: "files-photo", caption: "" }] } };
  await saveLocalDraft(saved, 1);
  await initializeLocalStore();
  await ingestLocalImportSession(input); // Native/picker replay never copies or duplicates.
  expect(await listLocalDrafts("local")).toEqual([saved]);
  const db = getRawMockDatabase();
  expect(db.prepare("select count(*) n from local_capture where id='files-photo'").get()).toEqual({ n: 1 });
  expect(db.prepare("select count(*) n from outbox").get()).toEqual({ n: 0 });
});
it("durably retains shared text even when there is no upload authorization", async () => {
  await initializeLocalStore();
  await ingestLocalImportSession({ id: "intake-text", source: "share", createdAt: "2026-09-07T01:00:00Z", queue: false, items: [{ externalId: "text", captureId: "shared-text", kind: "text", payload: { text: "等下次见面，再把这个故事讲完。" } }] });
  await initializeLocalStore();
  expect(getRawMockDatabase().prepare("select payload_json from local_capture where id='shared-text'").get()).toEqual({ payload_json: JSON.stringify({ text: "等下次见面，再把这个故事讲完。" }) });
  expect(getRawMockDatabase().prepare("select count(*) n from outbox where id='shared-text'").get()).toEqual({ n: 0 });
});
it("recovers an old copied-only receipt from its existing file, with no invented filename/time or upload", async () => {
  await initializeLocalStore();
  const db = getRawMockDatabase(), id = "10000000-0000-4000-8000-000000000050";
  db.prepare("insert into local_import_session(id,source,status,total_count,created_at,updated_at) values (?,'files','collecting',1,?,?)").run("legacy-intake", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z");
  db.prepare("insert into local_import_item(id,import_session_id,capture_id,external_id,sort_order,intake_state,local_uri,created_at,updated_at) values (?,'legacy-intake',?,'picker-0',0,'copied',?,?,?)").run("legacy-item", id, `file:///private/captures/${id}.jpg`, "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z");
  const { recoverCopiedIntakeCaptures } = await import("../src/native/intake-recovery");
  expect(await recoverCopiedIntakeCaptures("file:///private/captures", () => false)).toEqual({ recovered: 0, unavailable: 1 });
  expect(db.prepare("select count(*) n from local_capture where id=?").get(id)).toEqual({ n: 0 });
  db.exec("CREATE TRIGGER fail_recovery BEFORE INSERT ON local_capture BEGIN SELECT RAISE(ABORT, 'disk full'); END");
  await expect(recoverCopiedIntakeCaptures("file:///private/captures", () => true)).rejects.toThrow("disk full");
  db.exec("DROP TRIGGER fail_recovery");
  expect(await recoverCopiedIntakeCaptures("file:///private/captures", () => true)).toEqual({ recovered: 1, unavailable: 0 });
  const row = db.prepare("select payload_json from local_capture where id=?").get(id) as { payload_json: string };
  expect(JSON.parse(row.payload_json)).toMatchObject({ localUri: `file:///private/captures/${id}.jpg`, fileName: "原文件名未保留.jpg", lastModified: null, mediaType: "image" });
  expect(db.prepare("select count(*) n from outbox where id=?").get(id)).toEqual({ n: 0 });
  expect(await recoverCopiedIntakeCaptures("file:///private/captures", () => true)).toEqual({ recovered: 0, unavailable: 0 });
});

it("commits a shared mixed receipt to an existing draft once, and rolls everything back on disk failure", async () => {
  const { chooseLocalIntake, getLocalIntake } = await import("../src/native/intake-store");
  const { canUploadDraftOriginal } = await import("../src/drafts/store");
  const scope = JSON.stringify(["https://fixture.invalid", "instance", "author", "family"]);
  const draft = await createLocalDraft(scope, "joined-draft", "new-draft");
  const file: MediaCapturePayload = { localUri: "file:///private/captures/shared.wav", fileName: "外公的讲述.wav", mimeType: "audio/wav", mediaType: "audio", lastModified: null, source: "system_share" };
  await ingestLocalImportSession({ id: "mixed-intake", scope, source: "share", createdAt: "2026-09-07T01:00:00Z", queue: false, items: [
    { externalId: "text", captureId: "mixed-text", kind: "text", payload: { text: "河边撑船的故事" } },
    { externalId: "audio", captureId: "mixed-audio", kind: "file", payload: file, localUri: file.localUri },
  ] });
  expect(await canUploadDraftOriginal("mixed-audio", scope)).toBe(false); // even with old sync-all consent
  const input = { id: "mixed-intake", scope, expectedRevision: 0, destination: "draft" as const, draftId: draft.id, draftRevision: 1, mutationId: "join-mixed" };
  const db = getRawMockDatabase();
  db.exec("CREATE TRIGGER fail_destination BEFORE UPDATE ON local_intake_choice BEGIN SELECT RAISE(ABORT,'disk full'); END");
  await expect(chooseLocalIntake(input)).rejects.toThrow("disk full");
  expect((await listLocalDrafts(scope))[0]?.content.text).toBe("");
  expect((await getLocalIntake(input.id, scope))?.choice.destination).toBe("pending");
  db.exec("DROP TRIGGER fail_destination");
  expect(await chooseLocalIntake(input)).toMatchObject({ draftId: draft.id, uploadIds: [] });
  await initializeLocalStore();
  await chooseLocalIntake(input);
  const resumed = (await listLocalDrafts(scope))[0]!;
  expect(resumed.content.text).toBe("河边撑船的故事");
  expect(resumed.content.items.map(item => item.localCaptureRef)).toEqual(["mixed-audio"]);
  expect(resumed.revision).toBe(2);
  expect(await canUploadDraftOriginal("mixed-audio", scope)).toBe(false);
  expect(await canUploadDraftOriginal("mixed-audio", "other-account")).toBe(false);
  expect(await getLocalIntake(input.id, "other-account")).toBeNull();
  expect(db.prepare("select count(*) n from outbox where id in ('mixed-audio','mixed-text')").get()).toEqual({ n: 0 });
});

it("keeps thirty library-only originals, recovers upload consent after restart, and prevents cross-account transfers", async () => {
  const { chooseLocalIntake } = await import("../src/native/intake-store");
  const { canUploadDraftOriginal } = await import("../src/drafts/store");
  const { listLocalImportSessions } = await import("../src/storage/database");
  const input = { id: "thirty-intake", scope: "local", expectedRevision: 0, destination: "library" as const, mutationId: "choose-library" };
  await ingestLocalImportSession({ id: input.id, source: "share", createdAt: "2026-09-07T01:00:00Z", queue: false, items: Array.from({ length: 30 }, (_, index) => ({ externalId: `photo-${index}`, captureId: `thirty-${index}`, kind: "file" as const, localUri: `file:///private/captures/thirty-${index}.jpg`, payload: { localUri: `file:///private/captures/thirty-${index}.jpg`, fileName: `旧照片${index}.jpg`, mediaType: "image" as const, mimeType: "image/jpeg", lastModified: null, source: "system_share" as const } })) });
  expect((await chooseLocalIntake(input)).uploadIds).toHaveLength(0);
  const scope = JSON.stringify(["https://family.invalid", "instance-1", "account-1", "family-1"]);
  const bound = { ...input, scope, expectedRevision: 1 };
  expect((await chooseLocalIntake(bound)).uploadIds).toHaveLength(30);
  await initializeLocalStore();
  expect((await chooseLocalIntake(bound)).uploadIds).toHaveLength(30); // grant consent did not happen before termination
  expect((await listLocalImportSessions(scope)).some(row => row.id === input.id)).toBe(true);
  expect((await listLocalImportSessions("other-family")).some(row => row.id === input.id)).toBe(false);
  expect(await canUploadDraftOriginal("thirty-0", scope)).toBe(true);
  for (const other of [JSON.stringify(["https://family.invalid", "instance-2", "account-1", "family-1"]), JSON.stringify(["https://family.invalid", "instance-1", "account-2", "family-1"]), JSON.stringify(["https://family.invalid", "instance-1", "account-1", "family-2"])]) {
    expect(await canUploadDraftOriginal("thirty-0", other)).toBe(false);
    await expect(chooseLocalIntake({ ...bound, scope: other })).rejects.toThrow("其他账号或家庭");
  }
  const db = getRawMockDatabase();
  expect(db.prepare("select count(*) n from local_capture where id like 'thirty-%'").get()).toEqual({ n: 30 });
  expect(db.prepare("select count(*) n from outbox where id like 'thirty-%'").get()).toEqual({ n: 30 });
  expect(await listLocalDrafts(scope)).toEqual([]);
});
