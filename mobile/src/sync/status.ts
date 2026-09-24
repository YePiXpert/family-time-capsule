import { useEffect, useState } from "react";
import { idleSyncStatus, type SyncStatus } from "../local/context";
import { readConflicts, readRemoteState, subscribeSyncFiles } from "./state";

export async function readSyncStatus(): Promise<Omit<SyncStatus, "running">> {
  const [state, conflicts] = await Promise.all([
    readRemoteState().catch(() => null),
    readConflicts().catch(() => []),
  ]);
  return {
    joined: state?.enabled === true,
    ...(state?.lastSyncAt ? { lastSyncAt: state.lastSyncAt } : {}),
    ...(state?.lastError ? { lastError: state.lastError } : {}),
    conflicts: conflicts.length,
  };
}
let running = false;
const listeners = new Set<() => void>();
export function subscribeSyncRunning(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function markSyncRunning(value: boolean): void {
  if (running === value) return;
  running = value;
  for (const fn of listeners) fn();
}
export const isSyncRunning = () => running;
/**
 * 查空闲与占住在同一步完成：手动同步、恢复码加入与自动同步之间不能有 await 的空档，
 * 否则两轮同时写同一份清单临时文件。占到了才返回 true，结束时 markSyncRunning(false)。
 */
export function claimSync(): boolean {
  if (running) return false;
  markSyncRunning(true);
  return true;
}

let localBusy = false;
export function markLocalBusy(value: boolean): void {
  localBusy = value;
}
export const isLocalBusy = () => localBusy;

export function useSyncStatusValue(): SyncStatus {
  const [status, setStatus] = useState(idleSyncStatus);
  useEffect(() => {
    let live = true;
    let version = 0;
    const refresh = () => {
      const request = ++version;
      void readSyncStatus().then((next) => {
        if (live && request === version)
          setStatus({ ...next, running: isSyncRunning() });
      });
    };
    const unsubscribeFiles = subscribeSyncFiles(refresh);
    const unsubscribeRunning = subscribeSyncRunning(refresh);
    refresh();
    return () => {
      live = false;
      unsubscribeFiles();
      unsubscribeRunning();
    };
  }, []);
  return status;
}
