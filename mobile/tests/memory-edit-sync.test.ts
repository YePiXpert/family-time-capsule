import { beforeEach, expect, it, vi } from "vitest";
import type { MobileMemory } from "../src/types";
import type { LocalMemoryEdit } from "../src/memories/edit-model";

const api = vi.hoisted(() => ({ patch: vi.fn(), fetch: vi.fn() }));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
vi.mock("../src/api/client", async original => ({ ...await original<object>(), patchMobileMemory: api.patch, fetchMobileMemory: api.fetch }));
const { ApiError } = await import("../src/api/client");
const { initializeLocalStore, clearLocalArchive, clearServerCaches, getCachedMemoryDetail } = await import("../src/storage/database");
const { changeMemoryEdit, getMemoryEdit, drainMemoryEditWrites } = await import("../src/memories/edit-store");
const { memoryEditContent, memoryEditScope } = await import("../src/memories/edit-model");
const { memoryCacheScope } = await import("../src/memories/cache-scope");
const { syncMemoryEdits } = await import("../src/memories/edit-sync");
const { getRawMockDatabase } = await import("../../tests/mocks/expo-sqlite");

const credentials = { serverUrl: "https://family.test", instanceId: "instance", token: "synthetic-session" };
const scope = memoryEditScope(credentials, "author", "family")!;
const memory: MobileMemory = { id: "memory", title: "第一次去海边", bodyText: "家人写下的原文", titleRevision: 3,
  canWrite: true, isAuthor: true, visibility: "family", readerUserIds: [], occurredAt: "2026-08-15T09:30:00.000Z",
  occurredAtWall: "2026-08-15T09:30", occurredAtPrecision: "exact", ageDays: null, ageLabel: null, locationText: "海边",
  childPersonId: null, participantPersonIds: [], participants: [], sourceNotes: [], assets: [], contributions: [], updatedAt: "2026-09-01T00:00:00.000Z" };
function draft(text = "后来补写的一句", queued = true): LocalMemoryEdit {
  const base = memoryEditContent(memory), content = { ...base, bodyText: text };
  return { scope, memoryId: memory.id, base, baseRevision: 3, content, timezone: "UTC", savedContent: queued ? content : null,
    submission: null, conflict: null, blocked: false, problem: null, revision: 0, updatedAt: new Date().toISOString() };
}
const sync = (isCurrent = () => true) => syncMemoryEdits(credentials, scope, "author", "family", isCurrent);
beforeEach(async () => {
  await drainMemoryEditWrites(); await initializeLocalStore(); await clearLocalArchive();
  api.patch.mockReset(); api.fetch.mockReset();
});

it("retains unsent input over storage reopening and server cache resets, scoped to its account", async () => {
  await changeMemoryEdit(scope, memory.id, () => draft("断网时还没点保存", false));
  await initializeLocalStore(); await clearServerCaches();
  expect((await getMemoryEdit(scope, memory.id))?.content.bodyText).toBe("断网时还没点保存");
  expect(await getMemoryEdit(memoryEditScope(credentials, "other-author", "family")!, memory.id)).toBeNull();
  expect(await sync()).toEqual({ saved: 0, needsAttention: 0 });
  expect(api.patch).not.toHaveBeenCalled();
  await clearLocalArchive();
  expect(await getMemoryEdit(scope, memory.id)).toBeNull();
});

it("retries uncertain network receipts with exactly the same persisted operation and updates the cache before acknowledging", async () => {
  await changeMemoryEdit(scope, memory.id, () => draft());
  api.patch.mockRejectedValueOnce(new ApiError("network", 0));
  expect(await sync()).toEqual({ saved: 0, needsAttention: 1 });
  const submitted = (await getMemoryEdit(scope, memory.id))!.submission!;
  await initializeLocalStore();
  const remote = { ...memory, bodyText: submitted.content.bodyText, titleRevision: 4 };
  api.patch.mockResolvedValueOnce(remote);
  expect(await sync()).toEqual({ saved: 1, needsAttention: 0 });
  expect(api.patch.mock.calls[1]![2]).toEqual(api.patch.mock.calls[0]![2]);
  expect(api.patch.mock.calls[1]![2].mutationId).toBe(submitted.mutationId);
  expect(await getMemoryEdit(scope, memory.id)).toMatchObject({ baseRevision: 4, submission: null, savedContent: null, problem: null, base: memoryEditContent(remote) });
  expect(await getCachedMemoryDetail(memoryCacheScope(credentials, "author", "family")!, memory.id)).toEqual(remote);
});

it.each([false, true])("keeps later input while a previous save is in flight (explicitly saved later: %s)", async saveLater => {
  await changeMemoryEdit(scope, memory.id, () => draft("第一句"));
  let finish!: (value: MobileMemory) => void;
  api.patch.mockReturnValueOnce(new Promise<MobileMemory>(resolve => { finish = resolve; }));
  const running = sync();
  await vi.waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
  const operation = api.patch.mock.calls[0]![2].mutationId;
  await changeMemoryEdit(scope, memory.id, current => ({ ...current!, content: { ...current!.content, bodyText: "等待时又写的第二句" },
    savedContent: saveLater ? { ...current!.content, bodyText: "等待时又写的第二句" } : current!.savedContent }));
  finish({ ...memory, bodyText: "第一句", titleRevision: 4 });
  await running;
  expect(await getMemoryEdit(scope, memory.id)).toMatchObject({ content: { bodyText: "等待时又写的第二句" }, base: { bodyText: "第一句" }, baseRevision: 4, submission: null });
  api.patch.mockResolvedValueOnce({ ...memory, bodyText: "等待时又写的第二句", titleRevision: 5 });
  await sync();
  expect(api.patch).toHaveBeenCalledTimes(saveLater ? 2 : 1);
  if (saveLater) {
    expect(api.patch.mock.calls[1]![2]).toMatchObject({ expectedRevision: 4, bodyText: "等待时又写的第二句" });
    expect(api.patch.mock.calls[1]![2].mutationId).not.toBe(operation);
  } else expect((await getMemoryEdit(scope, memory.id))!.savedContent).toBeNull();
});

it("durably keeps both versions on conflict and sends nothing until the owner resolves it", async () => {
  await changeMemoryEdit(scope, memory.id, () => draft("我的补充"));
  api.patch.mockRejectedValueOnce(new ApiError("revision conflict", 409));
  const remote = { ...memory, title: "家人改了标题", bodyText: "家人的最新说明", titleRevision: 7 };
  api.fetch.mockResolvedValueOnce(remote);
  await sync();
  await initializeLocalStore();
  expect(await getMemoryEdit(scope, memory.id)).toMatchObject({ content: { bodyText: "我的补充" }, conflict: { revision: 7, content: { bodyText: "家人的最新说明" } } });
  await sync();
  expect(api.patch).toHaveBeenCalledOnce();
  await changeMemoryEdit(scope, memory.id, current => ({ ...current!, base: current!.conflict!.content, baseRevision: current!.conflict!.revision,
    savedContent: current!.content, conflict: null, submission: null }));
  api.patch.mockResolvedValueOnce({ ...remote, bodyText: "我的补充", titleRevision: 8 });
  await sync();
  expect(api.patch.mock.calls[1]![2]).toMatchObject({ expectedRevision: 7, bodyText: "我的补充" });
});

it("retains a blocked original without retry loops and excludes another family's edits", async () => {
  const other = memoryEditScope(credentials, "author", "other-family")!;
  await changeMemoryEdit(other, memory.id, () => draft("另一家庭的文字"));
  await changeMemoryEdit(scope, memory.id, () => draft("本家庭输入"));
  api.patch.mockRejectedValueOnce(new ApiError("removed", 404));
  await sync(); await sync();
  expect(api.patch).toHaveBeenCalledOnce();
  expect(await getMemoryEdit(scope, memory.id)).toMatchObject({ blocked: true, content: { bodyText: "本家庭输入" } });
  expect(await getMemoryEdit(other, memory.id)).toMatchObject({ savedContent: { bodyText: "另一家庭的文字" }, submission: null });
});

it("leaves the receipt pending if the active account changes before the server responds", async () => {
  await changeMemoryEdit(scope, memory.id, () => draft());
  let current = true;
  api.patch.mockImplementationOnce(async () => { current = false; return { ...memory, titleRevision: 4 }; });
  await sync(() => current);
  expect((await getMemoryEdit(scope, memory.id))!.submission).not.toBeNull();
  expect(await getCachedMemoryDetail(memoryCacheScope(credentials, "author", "family")!, memory.id)).toBeNull();
});

it("does not claim local success when a durable write fails", async () => {
  const db = getRawMockDatabase();
  db.exec("CREATE TRIGGER deny_edit BEFORE INSERT ON local_memory_edit BEGIN SELECT RAISE(ABORT, 'disk full'); END");
  try { await expect(changeMemoryEdit(scope, memory.id, () => draft())).rejects.toThrow("disk full"); }
  finally { db.exec("DROP TRIGGER deny_edit"); }
  expect(await getMemoryEdit(scope, memory.id)).toBeNull();
  expect(api.patch).not.toHaveBeenCalled();
});

it("keeps date precision, family timezone and participant IDs in the queued wire edit", async () => {
  const row = draft();
  row.timezone = "Asia/Shanghai";
  row.content = { ...row.content, title: "补充生日年份", precision: "year", occurredAt: "2019-12-31T16:00:00.000Z",
    location: "老家", participants: ["person-1", "person-2"], child: "person-1" };
  row.savedContent = row.content;
  await changeMemoryEdit(scope, memory.id, () => row);
  api.patch.mockResolvedValueOnce({ ...memory, titleRevision: 4 });
  await sync();
  expect(api.patch.mock.calls[0]![2]).toMatchObject({ title: "补充生日年份", occurredAtPrecision: "year", occurredAtWall: "2020",
    locationText: "老家", participantPersonIds: ["person-1", "person-2"], childPersonId: "person-1" });
  const unknown = draft();
  unknown.content = { ...unknown.content, precision: "unknown", occurredAt: null };
  unknown.savedContent = unknown.content;
  await changeMemoryEdit(scope, memory.id, () => unknown);
  api.patch.mockResolvedValueOnce({ ...memory, titleRevision: 4 });
  await sync();
  expect(JSON.parse(JSON.stringify(api.patch.mock.calls[1]![2]))).not.toHaveProperty("occurredAtWall");
});
