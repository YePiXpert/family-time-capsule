import { ApiError } from "../api/client";
import type {
  Credentials,
  MediaCapturePayload,
  OutboxItem,
  SyncPage,
  TextCapturePayload,
  TimelineEvent,
} from "../types";

export type SyncSummary = {
  eventCount: number;
  uploadedCount: number;
  failedCount: number;
  syncedAt: string;
};

export type SyncDependencies = {
  isConnected: () => Promise<boolean | null | undefined>;
  createSnapshotId: () => string;
  listOutbox: () => Promise<OutboxItem[]>;
  uploadTextCapture: (
    credentials: Credentials,
    id: string,
    text: string,
    importSessionId?: string,
  ) => Promise<string>;
  uploadMediaCapture: (
    credentials: Credentials,
    captureId: string,
    payload: MediaCapturePayload,
    onProgress: (uploadId: string, uploadOffset: number) => Promise<void>,
  ) => Promise<string>;
  updateMediaUploadState: (id: string, uploadId: string, uploadOffset: number) => Promise<void>;
  markOutboxFailure: (id: string, message: string) => Promise<void>;
  completeOutboxItem: (id: string, inboxItemId: string) => Promise<void>;
  fetchSyncPage: (
    credentials: Credentials,
    cursor: string | null,
  ) => Promise<SyncPage>;
  applySyncPage: (page: SyncPage, snapshotId: string) => Promise<void>;
  cacheEventCover: (
    credentials: Credentials,
    event: TimelineEvent,
  ) => Promise<string | null>;
  setLocalCoverUri: (eventId: string, uri: string) => Promise<void>;
  finishSyncSnapshot: (snapshotId: string, serverTime: string) => Promise<void>;
  listLocalCoverUris: () => Promise<string[]>;
  pruneCachedCovers: (referencedUris: string[]) => void;
};

function mustStopOutboxFlush(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return (
    error.status <= 0 ||
    error.status === 401 ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500
  );
}

async function flushOutbox(
  credentials: Credentials,
  dependencies: SyncDependencies,
): Promise<{ uploadedCount: number; failedCount: number }> {
  const items = await dependencies.listOutbox();
  let uploadedCount = 0;
  let failedCount = 0;
  for (const item of items) {
    try {
      if (item.kind === "text_capture") {
        const payload = item.payload as TextCapturePayload;
        const inboxItemId = payload.importSessionId
          ? await dependencies.uploadTextCapture(credentials, item.id, payload.text, payload.importSessionId)
          : await dependencies.uploadTextCapture(credentials, item.id, payload.text);
        await dependencies.completeOutboxItem(item.id, inboxItemId);
      } else {
        const payload = item.payload as MediaCapturePayload;
        const inboxItemId = await dependencies.uploadMediaCapture(
          credentials,
          item.id,
          payload,
          (uploadId, uploadOffset) => dependencies.updateMediaUploadState(
            item.id,
            uploadId,
            uploadOffset,
          ),
        );
        // The queue row is completed, while the original remains in the app's
        // private library so a server connection never becomes data ownership.
        await dependencies.completeOutboxItem(item.id, inboxItemId);
      }
      uploadedCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "上传失败";
      await dependencies.markOutboxFailure(item.id, message);
      // Authentication, server and transport failures normally affect every
      // remaining item, so stop promptly. A rejected individual capture must
      // remain visible in the durable outbox without starving later captures
      // or blocking a fresh server snapshot.
      if (mustStopOutboxFlush(error)) throw error;
      failedCount += 1;
    }
  }
  return { uploadedCount, failedCount };
}

export async function syncArchiveWithDependencies(
  credentials: Credentials,
  dependencies: SyncDependencies,
): Promise<SyncSummary> {
  if ((await dependencies.isConnected()) === false) {
    throw new Error("当前离线，已保留本地数据。");
  }

  const { uploadedCount, failedCount } = await flushOutbox(
    credentials,
    dependencies,
  );
  const snapshotId = dependencies.createSnapshotId();
  let cursor: string | null = null;
  let eventCount = 0;
  let serverTime = new Date().toISOString();
  do {
    const page = await dependencies.fetchSyncPage(credentials, cursor);
    await dependencies.applySyncPage(page, snapshotId);
    serverTime = page.serverTime;
    eventCount += page.events.length;

    for (const event of page.events) {
      try {
        const uri = await dependencies.cacheEventCover(credentials, event);
        if (uri) await dependencies.setLocalCoverUri(event.id, uri);
      } catch {
        // Metadata remains available offline even if one thumbnail fails.
      }
    }
    cursor = page.nextCursor;
  } while (cursor);

  await dependencies.finishSyncSnapshot(snapshotId, serverTime);
  try {
    dependencies.pruneCachedCovers(await dependencies.listLocalCoverUris());
  } catch {
    // Cache cleanup is best-effort and never invalidates a committed snapshot.
  }
  return { eventCount, uploadedCount, failedCount, syncedAt: serverTime };
}
