import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import {
  syncArchiveWithDependencies,
  type SyncDependencies,
} from "../src/sync/core";
import type { MediaCapturePayload, OutboxItem, SyncPage } from "../src/types";

const credentials = { serverUrl: "https://archive.example", token: "session" };

function page(nextCursor: string | null = null): SyncPage {
  return {
    apiVersion: 1,
    serverTime: "2026-09-03T20:00:00.000Z",
    viewer: {
      id: "user-1",
      name: "妈妈",
      role: "admin",
      personId: "person-1",
      canCapture: true,
      canReviewInbox: true,
      canCreateContributions: true,
      canEditEvents: true,
    },
    family: { id: "family-1", name: "小满家", timezone: "Asia/Shanghai" },
    people: [],
    events: [],
    nextCursor,
  };
}

function media(id: string): OutboxItem & {
  kind: "media_capture";
  payload: MediaCapturePayload;
} {
  return {
    id,
    kind: "media_capture",
    payload: {
      localUri: `file:///captures/${id}.jpg`,
      fileName: `${id}.jpg`,
      mimeType: "image/jpeg",
      lastModified: 1,
      mediaType: "image",
      source: "library",
    },
    createdAt: "2026-09-03T19:00:00.000Z",
    attemptCount: 0,
    lastError: null,
  };
}

function audio(id: string): ReturnType<typeof media> {
  return {
    ...media(id),
    payload: {
      localUri: `file:///captures/${id}.m4a`,
      fileName: `${id}.m4a`,
      mimeType: "audio/mp4",
      lastModified: 1,
      mediaType: "audio",
      source: "recorder",
    },
  };
}

function dependencies(): SyncDependencies {
  return {
    isConnected: vi.fn(async () => true),
    createSnapshotId: vi.fn(() => "snapshot-1"),
    listOutbox: vi.fn(async () => []),
    uploadTextCapture: vi.fn(async (_credentials, id) => id),
    uploadMediaCapture: vi.fn(async (_credentials, id) => id),
    updateMediaUploadState: vi.fn(async () => undefined),
    markOutboxFailure: vi.fn(async () => undefined),
    completeOutboxItem: vi.fn(async () => undefined),
    fetchSyncPage: vi.fn(async () => page()),
    applySyncPage: vi.fn(async () => undefined),
    cacheEventCover: vi.fn(async () => null),
    setLocalCoverUri: vi.fn(async () => undefined),
    finishSyncSnapshot: vi.fn(async () => undefined),
    listLocalCoverUris: vi.fn(async () => []),
    pruneCachedCovers: vi.fn(),
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("offline sync core", () => {
  it("does not touch the queue while definitely offline", async () => {
    const deps = dependencies();
    vi.mocked(deps.isConnected).mockResolvedValue(false);
    await expect(syncArchiveWithDependencies(credentials, deps)).rejects.toThrow(
      "当前离线",
    );
    expect(deps.listOutbox).not.toHaveBeenCalled();
  });

  it("commits a media queue row while retaining the local original", async () => {
    const deps = dependencies();
    const order: string[] = [];
    vi.mocked(deps.listOutbox).mockResolvedValue([media("media-1")]);
    vi.mocked(deps.uploadMediaCapture).mockImplementation(async () => {
      order.push("uploaded");
      return "inbox-media-1";
    });
    vi.mocked(deps.completeOutboxItem).mockImplementation(async () => {
      order.push("committed");
    });

    await expect(syncArchiveWithDependencies(credentials, deps)).resolves.toMatchObject({
      uploadedCount: 1,
      failedCount: 0,
    });
    expect(deps.uploadMediaCapture).toHaveBeenCalledWith(
      credentials,
      "media-1",
      expect.objectContaining({ fileName: "media-1.jpg" }),
      expect.any(Function),
    );
    expect(deps.completeOutboxItem).toHaveBeenCalledWith(
      "media-1",
      "inbox-media-1",
    );
    expect(order).toEqual(["uploaded", "committed"]);
  });

  it("uploads a direct recording with the same idempotent capture id", async () => {
    const deps = dependencies();
    vi.mocked(deps.listOutbox).mockResolvedValue([audio("recording-1")]);
    await expect(syncArchiveWithDependencies(credentials, deps)).resolves.toMatchObject({ uploadedCount: 1 });
    expect(deps.uploadMediaCapture).toHaveBeenCalledWith(
      credentials,
      "recording-1",
      expect.objectContaining({ mediaType: "audio", mimeType: "audio/mp4" }),
      expect.any(Function),
    );
    expect(deps.completeOutboxItem).toHaveBeenCalledWith("recording-1", "recording-1");
  });

  it("keeps ambiguous failures and never starts a destructive snapshot", async () => {
    const deps = dependencies();
    vi.mocked(deps.listOutbox).mockResolvedValue([media("network-1")]);
    vi.mocked(deps.uploadMediaCapture).mockRejectedValue(
      new ApiError("无法连接家庭服务器", 0),
    );

    await expect(syncArchiveWithDependencies(credentials, deps)).rejects.toThrow(
      "无法连接",
    );
    expect(deps.markOutboxFailure).toHaveBeenCalledWith(
      "network-1",
      "无法连接家庭服务器",
    );
    expect(deps.completeOutboxItem).not.toHaveBeenCalled();
    expect(deps.fetchSyncPage).not.toHaveBeenCalled();
  });

  it("retains a rejected item while syncing later valid work", async () => {
    const deps = dependencies();
    vi.mocked(deps.listOutbox).mockResolvedValue([
      media("unsupported"),
      media("valid"),
    ]);
    vi.mocked(deps.uploadMediaCapture).mockImplementation(
      async (_credentials, captureId) => {
        if (captureId === "unsupported") {
          throw new ApiError("不支持的原件", 415);
        }
        return captureId;
      },
    );

    await expect(syncArchiveWithDependencies(credentials, deps)).resolves.toMatchObject({
      uploadedCount: 1,
      failedCount: 1,
    });
    expect(deps.completeOutboxItem).toHaveBeenCalledWith("valid", "valid");
    expect(deps.finishSyncSnapshot).toHaveBeenCalledOnce();
  });

  it("never finalizes a partial multi-page snapshot", async () => {
    const deps = dependencies();
    vi.mocked(deps.fetchSyncPage)
      .mockResolvedValueOnce(page("page-2"))
      .mockRejectedValueOnce(new ApiError("server unavailable", 503));

    await expect(syncArchiveWithDependencies(credentials, deps)).rejects.toThrow(
      "server unavailable",
    );
    expect(deps.applySyncPage).toHaveBeenCalledOnce();
    expect(deps.finishSyncSnapshot).not.toHaveBeenCalled();
  });
});
