import { createContext, useContext, useSyncExternalStore } from "react";
import type { LocalStore } from "./store";
export const StoreContext = createContext<LocalStore | null>(null);
export function useStore() {
  const s = useContext(StoreContext);
  if (!s) throw new Error("Local store is unavailable");
  return s;
}
export function useLibrary() {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export type SyncStatus = {
  joined: boolean;
  lastSyncAt?: string;
  lastError?: string;
  conflicts: number;
  running: boolean;
};
export const idleSyncStatus: SyncStatus = {
  joined: false,
  conflicts: 0,
  running: false,
};
export const SyncStatusContext = createContext<SyncStatus>(idleSyncStatus);
export const useSyncStatus = () => useContext(SyncStatusContext);
