import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MediaCapturePayload,
  OutboxItem,
  SyncPage,
} from "../../mobile/src/types";

const api = vi.hoisted(() => {
  class TestApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return {
    ApiError: TestApiError,
    fetchSyncPage: vi.fn(),
    uploadTextCapture: vi.fn(),
  };
});

const database = vi.hoisted(() => ({
  applySyncPage: vi.fn(),
  completeOutboxItem: vi.fn(),
  finishSyncSnapshot: vi.fn(),
  listOutbox: vi.fn(),
  listLocalCoverUris: vi.fn(),
  markOutboxFailure: vi.fn(),
  setLocalCoverUri: vi.fn(),
}));

const files = vi.hoisted(() => ({
  cacheEventCover: vi.fn(),
  pruneCachedCovers: vi.fn(),
  uploadMediaCapture: vi.fn(),
}));

vi.mock("../../mobile/src/api/client", () => api);

const { syncArchiveWithDependencies } = await import(
  "../../mobile/src/sync/core"
);

const credentials = {
  serverUrl: "https://archive.example",
  token: "test-session",
};

function syncPage(overrides: Partial<SyncPage> = {}): SyncPage {
  return {
    apiVersion: 1,
    serverTime: "2026-09-03T20:00:00.000Z",
    viewer: {
      id: "user-1",
      name: "妈妈",
      role: "admin",
      canCapture: true,
      canEditEvents: true,
    },
    family: { id: "family-1", name: "小满家", timezone: "Asia/Shanghai" },
    people: [],
    events: [],
    nextCursor: null,
    ...overrides,
  };
}

function mediaItem(
  id: string,
): OutboxItem & { kind: "media_capture"; payload: MediaCapturePayload } {
  return {
    id,
    kind: "media_capture",
    payload: {
      localUri: `file:///captures/${id}.jpg`,
      fileName: `${id}.jpg`,
      mimeType: "image/jpeg",
      lastModified: 1_788_422_400_000,
      mediaType: "image",
      source: "library",
    },
    createdAt: "2026-09-03T19:00:00.000Z",
    attemptCount: 0,
    lastError: null,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  database.listOutbox.mockResolvedValue([]);
  database.listLocalCoverUris.mockResolvedValue([]);
  api.fetchSyncPage.mockResolvedValue(syncPage());
  files.cacheEventCover.mockResolvedValue(null);
  api.uploadTextCapture.mockImplementation(async (_credentials, id) => id);
  files.uploadMediaCapture.mockImplementation(async (_credentials, id) => id);
});

describe("native offline sync state machine", () => {
  const dependencies = () => ({
    isConnected: vi.fn(async () => true),
    createSnapshotId: vi.fn(() => "snapshot-1"),
    ...database,
    ...files,
    fetchSyncPage: api.fetchSyncPage,
    uploadTextCapture: api.uploadTextCapture,
  });

  it("does not touch the durable queue or server while definitely offline", async () => {
    const current = dependencies();
    current.isConnected.mockResolvedValue(false);

    await expect(syncArchiveWithDependencies(credentials, current)).rejects.toThrow(
      "当前离线，已保留本地数据。",
    );
    expect(database.listOutbox).not.toHaveBeenCalled();
    expect(api.fetchSyncPage).not.toHaveBeenCalled();
  });

  it("completes a media outbox row while retaining its private original", async () => {
    const order: string[] = [];
    database.listOutbox.mockResolvedValue([mediaItem("media-1")]);
    files.uploadMediaCapture.mockImplementation(async () => {
      order.push("server-confirmed");
      return "inbox-media-1";
    });
    database.completeOutboxItem.mockImplementation(async () => {
      order.push("queue-committed");
    });

    await expect(
      syncArchiveWithDependencies(credentials, dependencies()),
    ).resolves.toMatchObject({
      uploadedCount: 1,
      failedCount: 0,
    });
    expect(files.uploadMediaCapture).toHaveBeenCalledWith(
      credentials,
      "media-1",
      expect.objectContaining({ fileName: "media-1.jpg" }),
    );
    expect(database.completeOutboxItem).toHaveBeenCalledWith(
      "media-1",
      "inbox-media-1",
    );
    expect(order).toEqual(["server-confirmed", "queue-committed"]);
  });

  it("does not delete the private original after the server accepts it", async () => {
    database.listOutbox.mockResolvedValue([mediaItem("media-cleanup")]);

    await expect(
      syncArchiveWithDependencies(credentials, dependencies()),
    ).resolves.toMatchObject({ uploadedCount: 1, failedCount: 0 });
    expect(database.completeOutboxItem).toHaveBeenCalledWith(
      "media-cleanup",
      "media-cleanup",
    );
    expect(database.markOutboxFailure).not.toHaveBeenCalled();
  });

  it("retains one rejected capture without starving later valid captures", async () => {
    const rejected = mediaItem("rejected");
    const valid = mediaItem("valid");
    database.listOutbox.mockResolvedValue([rejected, valid]);
    files.uploadMediaCapture.mockImplementation(
      async (
        _credentials: typeof credentials,
        _captureId: string,
        payload: MediaCapturePayload,
      ) => {
        if (payload.fileName === "rejected.jpg") {
          throw new api.ApiError("服务器不支持这个原件格式。", 415);
        }
        return _captureId;
      },
    );

    await expect(
      syncArchiveWithDependencies(credentials, dependencies()),
    ).resolves.toMatchObject({
      uploadedCount: 1,
      failedCount: 1,
      eventCount: 0,
    });
    expect(database.markOutboxFailure).toHaveBeenCalledWith(
      "rejected",
      "服务器不支持这个原件格式。",
    );
    expect(database.completeOutboxItem).toHaveBeenCalledTimes(1);
    expect(database.completeOutboxItem).toHaveBeenCalledWith("valid", "valid");
    expect(api.fetchSyncPage).toHaveBeenCalledOnce();
  });

  it("refreshes server permissions after queued captures become forbidden", async () => {
    database.listOutbox.mockResolvedValue([mediaItem("now-read-only")]);
    files.uploadMediaCapture.mockRejectedValue(
      new api.ApiError("当前账号没有记录权限。", 403),
    );
    api.fetchSyncPage.mockResolvedValue(
      syncPage({
        viewer: {
          id: "user-1",
          name: "妈妈",
          role: "viewer",
          canCapture: false,
          canEditEvents: false,
        },
      }),
    );

    await expect(
      syncArchiveWithDependencies(credentials, dependencies()),
    ).resolves.toMatchObject({ uploadedCount: 0, failedCount: 1 });
    expect(database.completeOutboxItem).not.toHaveBeenCalled();
    expect(database.applySyncPage).toHaveBeenCalledWith(
      expect.objectContaining({
        viewer: expect.objectContaining({ canCapture: false }),
      }),
      "snapshot-1",
    );
    expect(database.finishSyncSnapshot).toHaveBeenCalledOnce();
  });

  it("retains the current item and stops on an ambiguous transport failure", async () => {
    database.listOutbox.mockResolvedValue([
      {
        id: "text-1",
        kind: "text_capture",
        payload: { text: "离线写下的一句话" },
        createdAt: "2026-09-03T19:00:00.000Z",
        attemptCount: 0,
        lastError: null,
      },
    ] satisfies OutboxItem[]);
    api.uploadTextCapture.mockRejectedValue(new Error("network unavailable"));

    await expect(
      syncArchiveWithDependencies(credentials, dependencies()),
    ).rejects.toThrow("network unavailable");
    expect(database.markOutboxFailure).toHaveBeenCalledWith(
      "text-1",
      "network unavailable",
    );
    expect(database.completeOutboxItem).not.toHaveBeenCalled();
    expect(api.fetchSyncPage).not.toHaveBeenCalled();
  });

  it("stops immediately on an expired bearer session without deleting data", async () => {
    database.listOutbox.mockResolvedValue([
      mediaItem("auth-1"),
      mediaItem("auth-2"),
    ]);
    files.uploadMediaCapture.mockRejectedValue(
      new api.ApiError("登录已过期，请重新登录。", 401),
    );

    await expect(
      syncArchiveWithDependencies(credentials, dependencies()),
    ).rejects.toThrow("登录已过期");
    expect(files.uploadMediaCapture).toHaveBeenCalledOnce();
    expect(database.markOutboxFailure).toHaveBeenCalledOnce();
    expect(database.completeOutboxItem).not.toHaveBeenCalled();
    expect(api.fetchSyncPage).not.toHaveBeenCalled();
  });

  it("does not finalize or prune a snapshot when a later page fails", async () => {
    api.fetchSyncPage
      .mockResolvedValueOnce(syncPage({ nextCursor: "page-2" }))
      .mockRejectedValueOnce(new api.ApiError("同步失败，请稍后重试。", 503));

    await expect(
      syncArchiveWithDependencies(credentials, dependencies()),
    ).rejects.toThrow("同步失败");
    expect(database.applySyncPage).toHaveBeenCalledOnce();
    expect(database.finishSyncSnapshot).not.toHaveBeenCalled();
  });

  it("completes every page while treating one failed cover as optional", async () => {
    const first = syncPage({
      nextCursor: "page-2",
      events: [
        {
          id: "event-1",
          title: "第一页",
          occurredAt: "2026-09-02T00:00:00.000Z",
          occurredAtPrecision: "exact",
          locationText: null,
          childPersonId: "child-1",
          ageDays: 1,
          ageLabel: "第 1 天",
          updatedAt: "2026-09-03T00:00:00.000Z",
          assetCount: 1,
          participantNames: [],
          captureIds: [],
          cover: {
            assetId: "asset-1",
            mediaAssetId: "thumb-1",
            type: "image",
            mimeType: "image/webp",
            path: "/api/media/thumb-1",
          },
        },
      ],
    });
    const second = syncPage({
      serverTime: "2026-09-03T20:01:00.000Z",
      events: [],
    });
    api.fetchSyncPage.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    files.cacheEventCover.mockRejectedValueOnce(new Error("thumbnail unavailable"));

    await expect(
      syncArchiveWithDependencies(credentials, dependencies()),
    ).resolves.toEqual({
      eventCount: 1,
      uploadedCount: 0,
      failedCount: 0,
      syncedAt: "2026-09-03T20:01:00.000Z",
    });
    expect(api.fetchSyncPage).toHaveBeenNthCalledWith(1, credentials, null);
    expect(api.fetchSyncPage).toHaveBeenNthCalledWith(2, credentials, "page-2");
    expect(database.applySyncPage).toHaveBeenCalledTimes(2);
    expect(database.setLocalCoverUri).not.toHaveBeenCalled();
    expect(database.finishSyncSnapshot).toHaveBeenCalledWith(
      "snapshot-1",
      "2026-09-03T20:01:00.000Z",
    );
    expect(files.pruneCachedCovers).toHaveBeenCalledWith([]);
  });
});
