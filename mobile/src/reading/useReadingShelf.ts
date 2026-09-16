import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useAppData } from "../state/AppContext";
import type { Credentials } from "../types";
import { readingDownloads } from "./native";
import { loadReadingShelf, type ReadingShelf, type ShelfPage } from "./shelf";
import type { ReadingKind } from "./types";

export function useReadingShelf<P extends ShelfPage>(
  kind: ReadingKind,
  deleted: boolean,
  fetchPage: (credentials: Credentials, deleted: boolean, cursor: string) => Promise<P>,
) {
  const { credentials, family, viewer, online: connected } = useAppData();
  const familyId = family?.id, userId = viewer?.id;
  const scopeKey = JSON.stringify([credentials?.serverUrl, credentials?.instanceId,
    credentials?.token, familyId, userId, connected, deleted]);
  const [result, setResult] = useState<{ scope: string; shelf: ReadingShelf<P> } | null>(null);
  const [status, setStatus] = useState({ scope: scopeKey, error: "", loading: false });
  const generation = useRef(0);
  const removedDuringLoad = useRef(new Set<string>());
  const load = useCallback(async (cursor = "") => {
    const request = ++generation.current;
    const removed = new Set<string>();
    removedDuringLoad.current = removed;
    if (!cursor) setResult(null);
    if (!credentials) {
      setStatus({ scope: scopeKey, error: "", loading: false });
      return;
    }
    setStatus({ scope: scopeKey, error: "", loading: true });
    try {
      const loaded = await loadReadingShelf({ credentials, connected, kind, deleted,
        familyId, userId,
        fetchPage: () => fetchPage(credentials, deleted, cursor) });
      if (generation.current !== request) return;
      const shelf = loaded.offline ? { ...loaded, downloads: loaded.downloads.filter(entry => !removed.has(entry.key)) } : loaded;
      setResult(previous => ({ scope: scopeKey, shelf: cursor && shelf.page &&
        previous?.scope === scopeKey && previous.shelf.page
        ? { ...shelf, page: { ...shelf.page, entries: [...previous.shelf.page.entries, ...shelf.page.entries] } }
        : shelf }));
      setStatus({ scope: scopeKey, error: "", loading: false });
    } catch (error) {
      if (generation.current !== request) return;
      setResult(null);
      setStatus({ scope: scopeKey, error: (error as Error).message, loading: false });
    }
  }, [credentials, connected, deleted, familyId, userId, kind, fetchPage, scopeKey]);
  useFocusEffect(useCallback(() => {
    void load();
    const unsubscribe = readingDownloads.subscribe(removed => {
      if (removed) {
        removedDuringLoad.current.add(removed);
        setResult(previous => previous?.shelf.offline
          ? { ...previous, shelf: { ...previous.shelf, downloads: previous.shelf.downloads.filter(entry => entry.key !== removed) } }
          : previous);
      }
    });
    return () => { generation.current++; unsubscribe(); };
  }, [load]));
  const shelf = result?.scope === scopeKey ? result.shelf : null;
  return { page: shelf?.page ?? null, downloads: shelf?.downloads ?? [],
    offline: shelf?.offline ?? false, load,
    error: status.scope === scopeKey ? status.error : "",
    loading: status.scope === scopeKey ? status.loading : !!credentials };
}
