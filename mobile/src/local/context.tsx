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
