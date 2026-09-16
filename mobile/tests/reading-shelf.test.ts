import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import { defaultBookLayout } from "../src/books/types";
import { ReadingError, type DownloadEntry } from "../src/reading/engine";
const mocks = vi.hoisted(() => ({ scope: vi.fn(), list: vi.fn(), get: vi.fn(), invalidate: vi.fn() }));
vi.mock("../src/reading/native", () => ({
  resolveReadingScope: mocks.scope,
  invalidateReadingCredentials: mocks.invalidate,
  nativeReadingStore: { list: mocks.list, get: mocks.get },
  readingFileUri: (key: string, media: { id: string }) => `file:///downloads/${key}/${media.id}.jpg`,
}));
const { loadReadingShelf, downloadedCoverUri } = await import("../src/reading/shelf");
const scope = { key: "a".repeat(64), serverUrl: "https://family.example.test", familyId: "family", userId: "reader" };
const credentials = { serverUrl: scope.serverUrl, instanceId: "instance-one", token: "token" };
function downloaded(id: string, changes: Partial<DownloadEntry> = {}): DownloadEntry {
  return {
    key: `${scope.key}/book-${id}`, scope: scope.key, kind: "book", id, title: id, state: "ready",
    reservedBytes: 0, storedBytes: 0, updatedAt: 1, error: null, completed: [],
    progress: { chapter: 0, page: 0, media: {} },
    manifest: { schemaVersion: 1, kind: "book", id, title: id, subtitle: "", revision: 1,
      digest: "b".repeat(64), familyId: scope.familyId, userId: scope.userId, audience: "family",
      timezone: "UTC", bytes: 0, chapters: [], media: [] },
    ...changes,
  };
}
const fetchPage = vi.fn();
function load(options: Partial<Parameters<typeof loadReadingShelf>[0]> = {}) {
  return loadReadingShelf({ credentials, connected: false, kind: "book", deleted: false,
    familyId: scope.familyId, userId: scope.userId, fetchPage, ...options });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.scope.mockResolvedValue({ scope, online: false });
  mocks.list.mockResolvedValue([]);
});

it("uses the current server list online without merging deleted or stale downloads", async () => {
  const page = { entries: [{ id: "fresh" }], nextCursor: null, canWrite: true };
  fetchPage.mockResolvedValue(page);
  const result = await load({ connected: true });
  expect(result).toEqual({ page, downloads: [], offline: false });
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.scope).not.toHaveBeenCalled();
});

it.each([401, 403, 404, 409, 500, 503])("never substitutes downloads for HTTP %i", async status => {
  fetchPage.mockRejectedValue(new ApiError("server rejected", status));
  await expect(load({ connected: true })).rejects.toMatchObject({ status });
  expect(mocks.scope).not.toHaveBeenCalled();
  expect(mocks.list).not.toHaveBeenCalled();
  if (status === 401 || status === 403) expect(mocks.invalidate).toHaveBeenCalledWith(credentials);
  else expect(mocks.invalidate).not.toHaveBeenCalled();
});

it("resolves the bound instance and account after a genuine network failure", async () => {
  fetchPage.mockRejectedValue(new ApiError("offline", 0));
  const ready = downloaded("first");
  mocks.list.mockResolvedValue([ready]);
  mocks.get.mockResolvedValue(ready);
  const result = await load({ connected: null });
  expect(mocks.scope).toHaveBeenCalledWith(credentials, { offline: false });
  expect(mocks.list).toHaveBeenCalledWith(scope.key);
  expect(result.downloads).toEqual([ready]);
  expect(result.offline).toBe(true);
});

it("does not use a reading copy if the identity request still reaches the server", async () => {
  fetchPage.mockRejectedValue(new ApiError("transient list failure", 0));
  mocks.scope.mockResolvedValue({ scope, online: true });
  await expect(load({ connected: true })).rejects.toThrow("暂时无法读取列表");
  expect(mocks.list).not.toHaveBeenCalled();
});

it("propagates revoked identity rather than showing the previous account's titles", async () => {
  fetchPage.mockRejectedValue(new ApiError("network", 0));
  mocks.scope.mockRejectedValue(new ReadingError("revoked", 403));
  await expect(load({ connected: true })).rejects.toMatchObject({ status: 403 });
  expect(mocks.list).not.toHaveBeenCalled();
});

it.each([{ familyId: "another-family" }, { userId: "another-reader" }])("rejects a changed family or reader before loading metadata: %j", async changed => {
  await expect(load(changed)).rejects.toMatchObject({ status: 403 });
  expect(mocks.list).not.toHaveBeenCalled();
});

it("shows only ready copies matching the bound scope, kind and manifest identity", async () => {
  const ready = downloaded("ready"),
    paused = downloaded("paused", { state: "paused" }),
    foreign = downloaded("foreign", { scope: "other-instance" }),
    collection = downloaded("album", { kind: "collection" }),
    revokedDuringRead = downloaded("revoked"),
    wrongUser = downloaded("wrong-user"),
    stale = downloaded("stale"),
    missing = downloaded("missing");
  mocks.list.mockResolvedValue([ready, paused, foreign, collection, revokedDuringRead, wrongUser, stale, missing]);
  mocks.get.mockImplementation(async key => ({
    [ready.key]: ready,
    [revokedDuringRead.key]: { ...revokedDuringRead, scope: "another-family" },
    [wrongUser.key]: { ...wrongUser, manifest: { ...wrongUser.manifest, userId: "other-user" } },
    [stale.key]: { ...stale, state: "failed" },
  })[key] ?? null);
  const result = await load();
  expect(result.downloads).toEqual([ready]);
  expect(fetchPage).not.toHaveBeenCalled();
  expect(mocks.get).not.toHaveBeenCalledWith(paused.key);
  expect(mocks.get).not.toHaveBeenCalledWith(foreign.key);
  expect(mocks.get).not.toHaveBeenCalledWith(collection.key);
});

it("does not include reading downloads in the recycle bin", async () => {
  await expect(load({ deleted: true })).rejects.toThrow("联网后可以查看回收站");
  expect(mocks.list).not.toHaveBeenCalled();
});

it("uses an explicit downloaded cover before later photos and ignores incomplete media", () => {
  const entry = downloaded("with-cover");
  entry.completed = ["cover", "photo"];
  entry.manifest.chapters = [{ id: "cover", title: "封面", blocks: [{ id: "cover", kind: "image", text: "", caption: "", images: ["missing", "cover", "photo"], layout: defaultBookLayout(), sourceLabels: [], dateLabel: "", author: null, memoryEventId: null }] }];
  entry.manifest.media = ["missing", "photo", "cover"].map(id => ({ id, filename: `${id}.jpg`, type: "image", mimeType: "image/jpeg", bytes: 0, sha256: "a".repeat(64), width: 100, height: 100, durationMs: null, author: null, dateLabel: "", memoryEventId: null, transcript: null }));
  expect(downloadedCoverUri(entry)).toBe(`file:///downloads/${entry.key}/cover.jpg`);
  entry.completed = [];
  expect(downloadedCoverUri(entry)).toBeUndefined();
});
