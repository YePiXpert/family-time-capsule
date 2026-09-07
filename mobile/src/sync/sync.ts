import { canUploadDraftOriginal } from "../drafts/store";
import { syncLocalDrafts } from "../drafts/sync";
import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import { fetchSyncPage, uploadTextCapture } from "../api/client";
import {
  getActiveDestination,
  applySyncPage,
  completeOutboxItem,
  finishSyncSnapshot,
  listLocalCoverUris,
  listOutbox,
  markOutboxFailure,
  setLocalCoverUri,
  updateMediaUploadState,
} from "../storage/database";
import {
  cacheEventCover,
  pruneCachedCovers,
  uploadMediaCapture,
} from "../storage/files";
import type { Credentials, OutboxItem } from "../types";
import {
  syncArchiveWithDependencies,
  type SyncSummary,
} from "./core";

export type { SyncSummary } from "./core";

export type SyncArchiveOptions = {
  isCurrent?: () => boolean;
  /** 上传授权门（M4）：未授权目的地的待传项保留在本机。 */
  authorizeUpload?: (item: OutboxItem) => Promise<boolean>;
};

export async function syncArchive(
  credentials: Credentials,
  options: SyncArchiveOptions = {},
): Promise<SyncSummary> {
  return syncArchiveWithDependencies(credentials, {
    afterUpload: () => syncLocalDrafts(credentials, options),
    isConnected: async () => (await Network.getNetworkStateAsync()).isConnected,
    createSnapshotId: () => Crypto.randomUUID(),
    listOutbox,
    authorizeUpload: async item => {
      const scope = await getActiveDestination();
      if (!scope || !await canUploadDraftOriginal(item.id, scope)) return false;
      return options.authorizeUpload ? options.authorizeUpload(item) : true;
    },
    isCurrent: options.isCurrent,
    uploadTextCapture,
    uploadMediaCapture,
    updateMediaUploadState,
    markOutboxFailure,
    completeOutboxItem,
    fetchSyncPage,
    applySyncPage,
    cacheEventCover,
    setLocalCoverUri,
    finishSyncSnapshot,
    listLocalCoverUris,
    pruneCachedCovers,
  });

}
