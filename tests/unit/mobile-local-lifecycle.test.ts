import { describe, expect, it } from "vitest";
import type { SyncPage, TimelineEvent } from "../../mobile/src/types";
import { getRawMockDatabase } from "../mocks/expo-sqlite";

const raw = getRawMockDatabase();

const {
  applySyncPage,
  archiveLocalCaptures,
  clearLocalArchive,
  completeOutboxItem,
  enqueueMediaCapture,
  finishSyncSnapshot,
  getOutboxCount,
  initializeLocalStore,
  listLocalMemoryMedia,
  listTimeline,
} = await import("../../mobile/src/storage/database");

function serverEvent(
  id: string,
  captureIds: string[],
): TimelineEvent {
  return {
    id,
    title: "正式记忆",
    occurredAt: "2026-09-03T21:00:00.000Z",
    occurredAtPrecision: "exact",
    locationText: null,
    childPersonId: "child-1",
    ageDays: 1,
    ageLabel: "第 1 天",
    updatedAt: "2026-09-04T01:00:00.000Z",
    assetCount: captureIds.length,
    participantNames: [],
    captureIds,
    cover: {
      assetId: "asset-1",
      mediaAssetId: "thumb-1",
      type: "image",
      mimeType: "image/webp",
      path: "/api/media/thumb-1",
    },
  };
}

function syncPage(events: TimelineEvent[]): SyncPage {
  return {
    apiVersion: 1,
    serverTime: "2026-09-04T02:00:00.000Z",
    viewer: {
      id: "user-1",
      name: "妈妈",
      role: "admin",
      canCapture: true,
      canReviewInbox: true,
      canCreateContributions: true,
      canEditEvents: true,
    },
    family: { id: "family-1", name: "小满家", timezone: "Asia/Shanghai" },
    people: [],
    events,
    nextCursor: null,
  };
}

async function enqueuePhoto(id: string): Promise<void> {
  await enqueueMediaCapture(id, {
    localUri: `file:///captures/${id}.jpg`,
    fileName: `${id}.jpg`,
    mimeType: "image/jpeg",
    lastModified: null,
    mediaType: "image",
    source: "library",
  });
}

describe.sequential("native capture lifecycle", () => {
  it("migrates rc.3 synced rows to inbox without losing the original", async () => {
    raw.exec(`
      CREATE TABLE local_capture (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('text_capture', 'media_capture')),
        title TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        local_uri TEXT,
        media_type TEXT CHECK(media_type IN ('image', 'video') OR media_type IS NULL),
        sync_state TEXT NOT NULL DEFAULT 'pending' CHECK(sync_state IN ('pending', 'synced'))
      );
      CREATE INDEX local_capture_occurred_idx
        ON local_capture(occurred_at DESC, id DESC);
      INSERT INTO local_capture VALUES (
        'legacy-capture', 'media_capture', '旧照片',
        '2026-09-03T21:00:00.000Z', 'file:///captures/legacy.jpg', 'image', 'synced'
      );
    `);

    await initializeLocalStore();

    expect(await listTimeline()).toEqual([
      expect.objectContaining({
        id: "local:legacy-capture",
        syncState: "inbox",
        localCoverUri: "file:///captures/legacy.jpg",
      }),
    ]);
    expect(
      raw.prepare(
        "SELECT inbox_item_id, memory_event_id, sync_state FROM local_capture",
      ).all(),
    ).toEqual([
      {
        inbox_item_id: "legacy-capture",
        memory_event_id: null,
        sync_state: "inbox",
      },
    ]);
  });

  async function resetStore(): Promise<void> {
    await initializeLocalStore();
    await clearLocalArchive();
  }

  it("moves pending to inbox to archived and keeps exactly one formal card after restart", async () => {
    await resetStore();
    await enqueuePhoto("capture-1");
    expect(await listTimeline()).toEqual([
      expect.objectContaining({ id: "local:capture-1", syncState: "pending" }),
    ]);

    await completeOutboxItem("capture-1", "inbox-1");
    expect(await getOutboxCount()).toBe(0);
    expect(await listTimeline()).toEqual([
      expect.objectContaining({
        id: "local:capture-1",
        syncState: "inbox",
        localCoverUri: "file:///captures/capture-1.jpg",
      }),
    ]);

    await archiveLocalCaptures(["inbox-1"], "memory-1");
    await applySyncPage(syncPage([serverEvent("memory-1", ["inbox-1"])]), "snapshot-1");
    await finishSyncSnapshot("snapshot-1", "2026-09-04T02:00:00.000Z");

    expect(await listTimeline()).toEqual([
      expect.objectContaining({
        id: "memory-1",
        source: "server",
        localCoverUri: "file:///captures/capture-1.jpg",
      }),
    ]);
    expect(
      raw.prepare(
        "SELECT local_uri, memory_event_id, sync_state FROM local_capture",
      ).all(),
    ).toEqual([
      {
        local_uri: "file:///captures/capture-1.jpg",
        memory_event_id: "memory-1",
        sync_state: "archived",
      },
    ]);
    expect(await listLocalMemoryMedia("memory-1")).toEqual([
      {
        captureId: "capture-1",
        title: "capture-1.jpg",
        localUri: "file:///captures/capture-1.jpg",
        mediaType: "image",
      },
    ]);

    await initializeLocalStore();
    expect((await listTimeline()).map((event) => event.id)).toEqual(["memory-1"]);
  });

  it("recovers a lost confirm response from sync and reconciles a multi-item merge", async () => {
    await resetStore();
    await enqueuePhoto("capture-a");
    await enqueuePhoto("capture-b");
    await completeOutboxItem("capture-a", "inbox-a");
    await completeOutboxItem("capture-b", "inbox-b");

    const event = serverEvent("memory-merged", ["inbox-a", "inbox-b"]);
    await applySyncPage(syncPage([event]), "snapshot-2");
    await finishSyncSnapshot("snapshot-2", "2026-09-04T02:00:00.000Z");

    expect((await listTimeline()).map((item) => item.id)).toEqual([
      "memory-merged",
    ]);
    expect(
      raw.prepare(
        "SELECT id, local_uri, memory_event_id, sync_state FROM local_capture ORDER BY id",
      ).all(),
    ).toEqual([
      {
        id: "capture-a",
        local_uri: "file:///captures/capture-a.jpg",
        memory_event_id: "memory-merged",
        sync_state: "archived",
      },
      {
        id: "capture-b",
        local_uri: "file:///captures/capture-b.jpg",
        memory_event_id: "memory-merged",
        sync_state: "archived",
      },
    ]);
    expect(await listLocalMemoryMedia("memory-merged")).toHaveLength(2);
  });

  it("treats server-only inbox confirmations as a safe no-op", async () => {
    await resetStore();
    await archiveLocalCaptures(["server-only-inbox"], "server-only-memory");
    await applySyncPage(
      syncPage([serverEvent("server-only-memory", ["server-only-inbox"])]),
      "snapshot-3",
    );
    await finishSyncSnapshot("snapshot-3", "2026-09-04T02:00:00.000Z");

    expect((await listTimeline()).map((event) => event.id)).toEqual([
      "server-only-memory",
    ]);
  });
});
