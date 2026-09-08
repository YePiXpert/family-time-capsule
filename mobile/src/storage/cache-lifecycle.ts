import { useSyncExternalStore } from "react";

// In-flight requests cannot outlive a committed cache replacement. A process
// restart needs no persisted counter because none of its old requests survive.
let revision = 0;
let permissionRevision = 0;
const listeners = new Set<() => void>();
export const getServerCacheRevision = () => revision;
const getPermissionRevision = () => permissionRevision;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function invalidateServerCacheViews(permissions = false) {
  revision++;
  if (permissions) permissionRevision++;
  listeners.forEach(listener => listener());
}
export function useServerCacheRevision() {
  return useSyncExternalStore(subscribe, getServerCacheRevision, getServerCacheRevision);
}
export function useServerPermissionRevision() {
  return useSyncExternalStore(subscribe, getPermissionRevision, getPermissionRevision);
}
