import { createElement, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MobileMemory } from "../src/types";
const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
vi.mock("../src/api/client", async original => ({ ...await original<object>(), fetchMobileMemory: api.fetch }));
const { initializeLocalStore, clearLocalArchive } = await import("../src/storage/database");
const { getRawMockDatabase } = await import("../../tests/mocks/expo-sqlite");
const { getMemoryEdit, changeMemoryEdit, drainMemoryEditWrites } = await import("../src/memories/edit-store");
const { useMemoryCapture } = await import("../src/memories/use-memory-capture");
const { ApiError } = await import("../src/api/client");
const { recoverMemoryEditLivePhoto } = await import("../src/memories/picker-recovery");
const credentials = { serverUrl: "https://family.test", instanceId: "instance", token: "session" };
const scope = JSON.stringify([credentials.serverUrl, "instance", "owner", "family"]);
const memory: MobileMemory = { id: "memory", title: "第一次看海", bodyText: "当天写的记录", titleRevision: 3, atomicEditVersion: 1,
  canWrite: true, isAuthor: true, visibility: "members", readerUserIds: ["grandparent"], coverAssetId: "old-cover", occurredAt: "2026-08-15T09:30:00.000Z",
  occurredAtWall: "2026-08-15T17:30", occurredAtPrecision: "exact", ageDays: null, ageLabel: null, locationText: "海边",
  childPersonId: null, participantPersonIds: [], participants: [], sourceNotes: [], assets: [], contributions: [], updatedAt: "2026-09-01T00:00:00.000Z" };
const payload = { localUri: "file:///captures/photo.jpg", fileName: "photo.jpg", mediaType: "image" as const, mimeType: "image/jpeg", source: "library" as const, lastModified: null };
let hook!: ReturnType<typeof useMemoryCapture>;
function Editor({ owner = scope, id = memory.id }: { owner?: string; id?: string }) { const state = useMemoryCapture(owner, id, credentials, "Asia/Shanghai", true); useLayoutEffect(() => { hook = state; }, [state]); return null; }
let tree: ReactTestRenderer | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(async () => { await drainMemoryEditWrites(); await initializeLocalStore(); await clearLocalArchive(); api.fetch.mockReset().mockResolvedValue(memory); });
afterEach(async () => { if (tree) await act(() => tree!.unmount()); tree = undefined; });

it("restores server edits, original references, privacy and the cover after an offline restart without submitting typing", async () => {
  await act(async () => { tree = create(createElement(Editor)); });
  expect(hook.draft?.content).toMatchObject({ text: "当天写的记录", visibility: "members", readerUserIds: ["grandparent"] });
  await act(async () => { hook.change({ text: "断网后补写的那句话", visibility: "private", readerUserIds: [] }); await hook.barrier(); });
  await act(async () => hook.addOriginal("photo", payload));
  const itemId = hook.draft!.content.items[0]!.id;
  await act(async () => { hook.change({ coverItemId: itemId }); await hook.barrier(); });
  expect((await getMemoryEdit(scope, memory.id))!.savedContent).toBeNull();
  await act(() => tree!.unmount()); await initializeLocalStore(); api.fetch.mockRejectedValue(new ApiError("offline", 0));
  await act(async () => { tree = create(createElement(Editor)); });
  expect(hook.draft?.content).toMatchObject({ text: "断网后补写的那句话", visibility: "private", readerUserIds: [], coverItemId: itemId, items: [{ localCaptureRef: "photo" }] });
  await act(async () => { await hook.save(true); });
  expect(await getMemoryEdit(scope, memory.id)).toMatchObject({ baseRevision: 3, submission: null, savedContent: { bodyText: "断网后补写的那句话", visibility: "private", newCoverItemId: itemId, coverAssetId: "old-cover", items: [{ localCaptureRef: "photo" }] } });
  expect(getRawMockDatabase().prepare("SELECT COUNT(*) count FROM local_draft").get()).toEqual({ count: 0 });
  expect(getRawMockDatabase().prepare("SELECT COUNT(*) count FROM outbox").get()).toEqual({ count: 0 });
});

it("retains text and prevents leaving when SQLite rejects the write, then retries the same memory", async () => {
  await act(async () => { tree = create(createElement(Editor)); });
  const db = getRawMockDatabase();
  db.exec("CREATE TRIGGER deny_memory_input BEFORE UPDATE ON local_memory_edit BEGIN SELECT RAISE(ABORT, 'disk full'); END");
  try {
    await act(async () => { hook.change({ text: "不能丢的最后几个字" }); });
    await expect(hook.barrier()).rejects.toThrow("disk full");
    expect(hook.draft?.content.text).toBe("不能丢的最后几个字"); expect(hook.error).toContain("disk full");
    expect((await getMemoryEdit(scope, memory.id))!.content.bodyText).toBe("当天写的记录");
  } finally { db.exec("DROP TRIGGER deny_memory_input"); }
  await act(async () => { await hook.retry(); await hook.barrier(); });
  expect((await getMemoryEdit(scope, memory.id))!.content.bodyText).toBe("不能丢的最后几个字");
  expect(getRawMockDatabase().prepare("SELECT COUNT(*) count FROM local_memory_edit").get()).toEqual({ count: 1 });
});

it("does not resurrect an acknowledged original when the owner keeps typing during synchronization", async () => {
  await act(async () => { tree = create(createElement(Editor)); });
  await act(async () => hook.addOriginal("photo", payload));
  const item = hook.draft!.content.items[0]!;
  await act(async () => { await changeMemoryEdit(scope, memory.id, current => ({ ...current!, appliedItemIds: [item.id], baseRevision: 4, content: { ...current!.content, items: [] } })); });
  await act(async () => { hook.change({ text: "上传完成时仍在继续写" }); await hook.barrier(); });
  expect((await getMemoryEdit(scope, memory.id))!.content).toMatchObject({ bodyText: "上传完成时仍在继续写", items: [] });
  expect(hook.draft?.content.items).toEqual([]);
});

it("isolates a late memory response from a newly selected family", async () => {
  let finish!: (value: MobileMemory) => void;
  api.fetch.mockReturnValueOnce(new Promise<MobileMemory>(resolve => { finish = resolve; }));
  await act(async () => { tree = create(createElement(Editor)); });
  const other = JSON.stringify([credentials.serverUrl, "instance", "other", "other-family"]);
  api.fetch.mockResolvedValue({ ...memory, bodyText: "新家庭可读内容" });
  await act(async () => tree!.update(createElement(Editor, { owner: other })));
  expect(hook.draft?.content.text).toBe("新家庭可读内容");
  await act(async () => finish(memory));
  expect(hook.draft?.content.text).toBe("新家庭可读内容");
  expect(await getMemoryEdit(scope, memory.id)).toBeNull();
});

it("recovers an interrupted Live Photo into the same memory with a missing-component marker and no new event", async () => {
  await act(async () => { tree = create(createElement(Editor)); });
  const receipt = { version: 2 as const, captureId: "capture-pair", scope, draftId: memory.id, memoryEditTarget: memory.id,
    expectedRevision: hook.draft!.revision, createdAt: new Date().toISOString(), originals: [
      { id: "image-part", itemId: "image-item", role: "image" as const, payload },
      { id: "video-part", itemId: "video-item", role: "video" as const, payload: { ...payload, mediaType: "video" as const, localUri: "file:///captures/video.mov", mimeType: "video/quicktime", fileName: "video.mov" } },
    ] };
  await act(async () => recoverMemoryEditLivePhoto(receipt, uri => uri === payload.localUri));
  await act(async () => recoverMemoryEditLivePhoto(receipt, uri => uri === payload.localUri));
  const restored = (await getMemoryEdit(scope, memory.id))!;
  expect(restored.content.items).toHaveLength(2);
  expect(restored.content.items?.[1]).toMatchObject({ localCaptureRef: null, preservationState: "missing", livePhotoRole: "video" });
  expect(restored.savedContent).toBeNull();
  expect(getRawMockDatabase().prepare("SELECT COUNT(*) count FROM local_draft").get()).toEqual({ count: 0 });
});


it("removes a denied detail from offline cache while retaining the owner's unsubmitted input", async () => {
  await act(async () => { tree = create(createElement(Editor)); });
  await act(async () => { hook.change({ text: "权限变化前写了一半" }); await hook.barrier(); });
  await act(() => tree!.unmount()); api.fetch.mockRejectedValue(new ApiError("revoked", 403));
  await act(async () => { tree = create(createElement(Editor)); });
  expect(hook.draft).toBeNull(); expect(hook.error).toContain("revoked");
  expect((await getMemoryEdit(scope, memory.id))!.content.bodyText).toBe("权限变化前写了一半");
  await act(() => tree!.unmount()); api.fetch.mockRejectedValue(new ApiError("offline", 0));
  await act(async () => { tree = create(createElement(Editor)); });
  expect(hook.draft).toBeNull(); expect(hook.memory).toBeNull();
});


it("can reopen after an initial network failure without leaving the editor", async () => {
  api.fetch.mockRejectedValueOnce(new ApiError("offline", 0));
  await act(async () => { tree = create(createElement(Editor)); });
  expect(hook.draft).toBeNull(); expect(hook.error).toBe("offline");
  await act(async () => { await hook.retry(); });
  expect(hook.draft?.content.text).toBe("当天写的记录"); expect(hook.error).toBeNull();
});

it.each([new ApiError("server unavailable", 500), new ApiError("invalid response", 422), new Error("malformed response")])("requires a successful read after %s even when a writable detail was cached", async reason => {
  await act(async () => { tree = create(createElement(Editor)); });
  await act(async () => { hook.change({ text: "服务出错前的输入" }); await hook.barrier(); });
  await act(() => tree!.unmount()); api.fetch.mockRejectedValueOnce(reason);
  await act(async () => { tree = create(createElement(Editor)); });
  expect(hook.draft).toBeNull(); expect(hook.memory).toBeNull(); expect(hook.error).toBe(reason.message);
  expect((await getMemoryEdit(scope, memory.id))!.content.bodyText).toBe("服务出错前的输入");
  await act(async () => { await hook.retry(); });
  expect(hook.draft?.content.text).toBe("服务出错前的输入"); expect(hook.error).toBeNull();
});
