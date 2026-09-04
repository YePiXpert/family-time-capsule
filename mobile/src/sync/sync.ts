import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import { fetchSyncPage, uploadTextCapture } from "../api/client";
import {
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
import type { Credentials } from "../types";
import {
  syncArchiveWithDependencies,
  type SyncSummary,
} from "./core";

export type { SyncSummary } from "./core";

export async function syncArchive(credentials: Credentials): Promise<SyncSummary> {
  return syncArchiveWithDependencies(credentials, {
    isConnected: async () => (await Network.getNetworkStateAsync()).isConnected,
    createSnapshotId: () => Crypto.randomUUID(),
    listOutbox,
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
