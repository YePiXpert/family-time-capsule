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
