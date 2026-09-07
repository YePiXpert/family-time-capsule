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
  /** 因未获目的地授权而保留在本机的记录数（M4）。 */
  skippedUploadCount: number;
  syncedAt: string;
};

export type SyncDependencies = {
  /** Stop writes from a superseded connection, including late upload replies. */
  isCurrent?: () => boolean;
  afterUpload?: () => Promise<void>;
  isConnected: () => Promise<boolean | null | undefined>;
  createSnapshotId: () => string;
  listOutbox: () => Promise<OutboxItem[]>;
  /**
   * 上传授权门（M4）：返回 false 的待传项保持本机，不算失败也不阻塞
   * 家庭资料下载。缺省视为全部允许（兼容旧测试装配）。
   */
  authorizeUpload?: (item: OutboxItem) => Promise<boolean>;
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
  applySyncPage: (
    credentials: Credentials,
    page: SyncPage,
    snapshotId: string,
  ) => Promise<void>;
  cacheEventCover: (
    credentials: Credentials,
    event: TimelineEvent,
  ) => Promise<string | null>;
  setLocalCoverUri: (eventId: string, uri: string) => Promise<void>;
  finishSyncSnapshot: (snapshotId: string, serverTime: string) => Promise<void>;
  listLocalCoverUris: () => Promise<string[]>;
  pruneCachedCovers: (referencedUris: string[]) => void;
};

function assertCurrent(dependencies: SyncDependencies) {
  if (dependencies.isCurrent?.() === false) throw new ApiError("连接已切换，旧同步结果已丢弃。", 409, "connection_changed");
}

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
): Promise<{ uploadedCount: number; failedCount: number; skippedCount: number }> {
  assertCurrent(dependencies);
  const items = await dependencies.listOutbox();
  assertCurrent(dependencies);
  let uploadedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  for (const item of items) {
    assertCurrent(dependencies);
    if (dependencies.authorizeUpload && !(await dependencies.authorizeUpload(item))) {
      skippedCount += 1;
      continue;
    }
    assertCurrent(dependencies);
    try {
      if (item.kind === "text_capture") {
        const payload = item.payload as TextCapturePayload;
        const inboxItemId = payload.importSessionId
          ? await dependencies.uploadTextCapture(credentials, item.id, payload.text, payload.importSessionId)
          : await dependencies.uploadTextCapture(credentials, item.id, payload.text);
        assertCurrent(dependencies);
        await dependencies.completeOutboxItem(item.id, inboxItemId);
      } else {
        const payload = item.payload as MediaCapturePayload;
        const inboxItemId = await dependencies.uploadMediaCapture(
          credentials,
          item.id,
          payload,
          (uploadId, uploadOffset) => { assertCurrent(dependencies); return dependencies.updateMediaUploadState(item.id, uploadId, uploadOffset); },
        );
        // The queue row is completed, while the original remains in the app's
        // private library so a server connection never becomes data ownership.
        assertCurrent(dependencies);
        await dependencies.completeOutboxItem(item.id, inboxItemId);
      }
      uploadedCount += 1;
    } catch (error) {
      assertCurrent(dependencies);
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
  return { uploadedCount, failedCount, skippedCount };
}

export async function syncArchiveWithDependencies(
  credentials: Credentials,
  dependencies: SyncDependencies,
): Promise<SyncSummary> {
  assertCurrent(dependencies);
  if ((await dependencies.isConnected()) === false) {
    throw new Error("当前离线，已保留本地数据。");
  }

  const { uploadedCount, failedCount, skippedCount } = await flushOutbox(
    credentials,
    dependencies,
  );
  await dependencies.afterUpload?.();
  assertCurrent(dependencies);
  const snapshotId = dependencies.createSnapshotId();
  let cursor: string | null = null;
  let eventCount = 0;
  let serverTime = new Date().toISOString();
  do {
    assertCurrent(dependencies);
    const page = await dependencies.fetchSyncPage(credentials, cursor);
    assertCurrent(dependencies);
    await dependencies.applySyncPage(credentials, page, snapshotId);
    serverTime = page.serverTime;
    eventCount += page.events.length;

    for (const event of page.events) {
      assertCurrent(dependencies);
      try {
        const uri = await dependencies.cacheEventCover(credentials, event);
        assertCurrent(dependencies);
        if (uri) await dependencies.setLocalCoverUri(event.id, uri);
      } catch {
        assertCurrent(dependencies);
        // Metadata remains available offline even if one thumbnail fails.
      }
    }
    cursor = page.nextCursor;
  } while (cursor);

  assertCurrent(dependencies);
  await dependencies.finishSyncSnapshot(snapshotId, serverTime);
  try {
    const uris = await dependencies.listLocalCoverUris();
    assertCurrent(dependencies);
    dependencies.pruneCachedCovers(uris);
  } catch {
    assertCurrent(dependencies);
    // Cache cleanup is best-effort and never invalidates a committed snapshot.
  }
  return { eventCount, uploadedCount, failedCount, skippedUploadCount: skippedCount, syncedAt: serverTime };
}
