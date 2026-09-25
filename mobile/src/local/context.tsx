import { createContext, useContext, useSyncExternalStore } from "react";
import type { Library } from "./model";
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
/**
 * 只取库里的一个值（布尔、字符串这类可以直接比相等的）：别的改动不让这个组件重渲染。
 * 入口 Root 只看欢迎页与应用锁，订整个库的话每存一次草稿整棵导航树都要跟着渲染。
 */
export function useLibraryValue<T>(select: (library: Library) => T): T {
  const store = useStore();
  const read = () => select(store.get());
  return useSyncExternalStore(store.subscribe, read, read);
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
