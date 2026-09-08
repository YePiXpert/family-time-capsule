import { beforeEach, expect, it, vi } from "vitest";
import type { MobileMemory, SyncPage } from "../src/types";
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../src/reading/native", () => ({ invalidateReadingCredentials: vi.fn() }));
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-network", () => ({ getNetworkStateAsync: async () => ({ isConnected: true }) }));
vi.mock("../src/drafts/sync", () => ({ syncLocalDrafts: async () => undefined }));
vi.mock("../src/native/intake-sync", () => ({ syncLocalIntake: async () => undefined }));
vi.mock("../src/storage/files", () => ({ cacheEventCover: async () => null, pruneCachedCovers: () => undefined, uploadMediaCapture: vi.fn() }));
vi.mock("../src/api/client", async original => ({ ...await original<object>(), fetchSyncPage: mocks.fetch }));
const store = await import("../src/storage/database");
const { syncArchive } = await import("../src/sync/sync");
const { offlineSearch } = await import("../src/search/offline-search");
const { memoryCacheScope } = await import("../src/memories/cache-scope");
const credentials = { serverUrl: "https://synthetic.invalid", instanceId: "instance", token: "session-b" };
const scope = memoryCacheScope(credentials, "b", "family")!;
const at = "2026-09-08T00:00:00.000Z";
const page: SyncPage = { apiVersion: 1, serverTime: at, viewer: { id: "b", name: "家人B", role: "viewer", personId: "person-b", canCapture: false, canReviewInbox: false, canCreateContributions: false, canEditEvents: false }, family: { id: "family", name: "合成家庭", timezone: "UTC" }, people: [], events: [{ id: "event", title: "旧版标题", occurredAt: at, occurredAtPrecision: "unknown", locationText: null, childPersonId: null, ageDays: null, ageLabel: null, updatedAt: at, assetCount: 0, participantNames: [], captureIds: [], cover: null }], nextCursor: null };
const detail: MobileMemory = { id: "event", title: "旧版标题", occurredAt: at, occurredAtWall: "2026-09-08T00:00", occurredAtPrecision: "unknown", locationText: null, childPersonId: null, ageDays: null, ageLabel: null, updatedAt: at, participantPersonIds: [], participants: [], assets: [], contributions: [], sourceNotes: [{ id: "note", text: "已撤回的海边暗号" }] };
beforeEach(async () => {
  mocks.fetch.mockReset();
  await store.initializeLocalStore(); await store.clearLocalArchive();
  await store.applySyncPage(credentials, page, "baseline"); await store.finishSyncSnapshot("baseline", at);
  await store.cacheMemoryDetail(scope, detail);
});
it("a successful authorization snapshot removes revoked details from offline search without reopening them", async () => {
  const search = () => offlineSearch({ credentials, userId: "b", familyId: "family", query: "海边暗号" });
  expect((await search()).map(result => result.id)).toContain("event");
  mocks.fetch.mockResolvedValue({ ...page, events: [] });
  await syncArchive(credentials);
  expect(await store.getCachedMemoryDetail(scope, "event")).toBeNull();
  expect(await search()).toEqual([]);
});
it("an interrupted multi-page snapshot leaves the previous complete timeline intact", async () => {
  mocks.fetch.mockResolvedValueOnce({ ...page, events: [{ ...page.events[0]!, title: "未完成整轮的新标题" }], nextCursor: "second-page" }).mockRejectedValueOnce(new Error("synthetic disconnected page 2"));
  await expect(syncArchive(credentials)).rejects.toThrow("disconnected page 2");
  expect((await store.listTimeline(scope)).filter(event => event.source === "server")).toMatchObject([{ id: "event", title: "旧版标题" }]);
  expect(await store.getCachedMemoryDetail(scope, "event")).toEqual(detail);
});

const protocol = (changes: Partial<SyncPage> = {}, mode: "snapshot" | "delta" = "snapshot", checkpoint = "checkpoint-1"): SyncPage => ({
  ...page, tombstones: [], sync: { protocol: 2, mode, generation: "generation-1", permissionStamp: "permission-1", checkpoint, invalidateResources: false }, ...changes,
});
it("incremental sync resumes the committed checkpoint, retains unrelated rows and applies tombstones atomically", async () => {
  mocks.fetch.mockResolvedValue(protocol({ events: [...page.events, { ...page.events[0]!, id: "other", title: "仍可读" }] }));
  await syncArchive(credentials); await store.cacheMemoryDetail(scope, { ...detail, id: "other" });
  mocks.fetch.mockReset();
  mocks.fetch.mockResolvedValue(protocol({ events: [], people: [], tombstones: [{ kind: "memory", id: "event" }] }, "delta", "checkpoint-2"));
  await syncArchive(credentials);
  expect(mocks.fetch).toHaveBeenCalledWith(credentials, "checkpoint-1");
  expect((await store.listTimeline(scope)).map(row => row.id)).toEqual(["other"]);
  expect(await store.getCachedMemoryDetail(scope, "other")).not.toBeNull();
  expect(await store.getSyncCheckpoint(credentials)).toBe("checkpoint-2");
});
it("a failed delta leaves both the committed checkpoint and previous rows intact", async () => {
  mocks.fetch.mockResolvedValue(protocol()); await syncArchive(credentials);
  await store.cacheMemoryDetail(scope, detail);
  mocks.fetch.mockReset();
  mocks.fetch.mockResolvedValueOnce(protocol({ events: [], tombstones: [{ kind: "memory", id: "event" }], nextCursor: "page-2", sync: { ...protocol().sync!, mode: "delta", checkpoint: null } }, "delta"))
    .mockRejectedValueOnce(new Error("disconnected"));
  await expect(syncArchive(credentials)).rejects.toThrow("disconnected");
  expect(await store.getSyncCheckpoint(credentials)).toBe("checkpoint-1");
  expect(await store.getCachedMemoryDetail(scope, "event")).toEqual(detail);
  expect((await store.listTimeline(scope)).map(row => row.id)).toContain("event");
});
it("a known permission reset immediately clears remote caches even if rebuilding disconnects, preserving owned captures", async () => {
  const { ApiError } = await import("../src/api/client");
  await store.enqueueTextCapture("owned-local", { text: "我的未上传原文" });
  // Keep the local record without invoking an upload in this download-only fixture.
  await store.keepOutboxItemLocal("owned-local");
  mocks.fetch.mockRejectedValueOnce(new ApiError("permissions changed",409,"sync_reset"))
    .mockRejectedValueOnce(new Error("snapshot disconnected"));
  await expect(syncArchive(credentials)).rejects.toThrow("snapshot disconnected");
  expect(await store.getCachedMemoryDetail(scope,"event")).toBeNull();
  expect((await store.listTimeline(scope)).filter(row => row.source === "server")).toEqual([]);
  expect(await store.getLocalCaptureDetail("owned-local")).not.toBeNull();
});
it("a malformed mixed-generation round rolls back instead of saving a new checkpoint", async () => {
  mocks.fetch.mockResolvedValueOnce(protocol({ nextCursor: "page-2", sync: { ...protocol().sync!, checkpoint: null } }))
    .mockResolvedValueOnce(protocol({ events: [], sync: { ...protocol().sync!, generation: "generation-2" } }));
  await expect(syncArchive(credentials)).rejects.toThrow("分页版本不一致");
  expect((await store.listTimeline(scope)).find(row => row.id === "event")?.title).toBe("旧版标题");
});
