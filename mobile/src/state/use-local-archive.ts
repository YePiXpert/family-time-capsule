import { useCallback, useRef, useState, type MutableRefObject } from "react";
import {
  getCachedFamily, getCachedMobileHome, getCachedViewer, getMeta, getSyncConsent,
  listCachedPeople, listOutbox, listTimeline, setMeta,
} from "../storage/database";
import { memoryCacheScope } from "../memories/cache-scope";
import { setHapticsEnabled as applyHapticsEnabled } from "../design/haptics";
import type { AppContextValue } from "./contracts";
import type { Credentials, MobileHome, SyncConsent } from "../types";
import type { ThemeMode } from "../theme";

type Identity = {
  credentialsRef: MutableRefObject<Credentials | null>;
  userIdRef: MutableRefObject<string | null>;
  familyIdRef: MutableRefObject<string | null>;
  destGenRef: MutableRefObject<number>;
  consentRef: MutableRefObject<SyncConsent | null>;
};
type Snapshot = Pick<AppContextValue, "family" | "viewer" | "people" | "events" | "outbox" |
  "home" | "lastSyncAt" | "welcomeSeen" | "displayMode" | "themeMode" | "hapticsEnabled" | "syncConsent">;
const emptySnapshot: Snapshot = {
  family: null, viewer: null, people: [], events: [], outbox: [], home: null,
  lastSyncAt: null, welcomeSeen: null, displayMode: null, themeMode: null,
  hapticsEnabled: true, syncConsent: null,
};

/** Publishes complete local snapshots; failed/stale reads never replace the last usable view. */
export function useLocalArchive({ credentialsRef, userIdRef, familyIdRef, destGenRef, consentRef }: Identity) {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [localReadError, setLocalReadError] = useState<string | null>(null);
  const readRevision = useRef(0);
  const reloadLocal = useCallback(async () => {
    const generation = destGenRef.current;
    const revision = ++readRevision.current;
    const isCurrent = () => generation === destGenRef.current && revision === readRevision.current;
    setLocalReadError(null);
    try {
      const credentials = credentialsRef.current;
      const cacheScope = memoryCacheScope(credentials, userIdRef.current ?? undefined, familyIdRef.current ?? undefined);
      const draftScope = credentials ? (credentials.instanceId && userIdRef.current && familyIdRef.current
        ? JSON.stringify([credentials.serverUrl, credentials.instanceId, userIdRef.current, familyIdRef.current]) : null) : "local";
      const [events, family, viewer, people, outbox, lastSyncAt, home, welcomeDone,
        syncConsent, displayMode, themeMode, haptics] = await Promise.all([
        listTimeline(cacheScope, draftScope), getCachedFamily(), getCachedViewer(),
        listCachedPeople(cacheScope), listOutbox(), getMeta("last_sync_at"),
        getCachedMobileHome(), getMeta("welcome_done"), getSyncConsent(),
        getMeta("display_mode"), getMeta("theme_mode"), getMeta("haptics_enabled"),
      ]);
      if (!isCurrent()) return;
      consentRef.current = syncConsent;
      applyHapticsEnabled(haptics !== "0");
      setSnapshot({ events, family, viewer, people, outbox, lastSyncAt, home, syncConsent,
        welcomeSeen: welcomeDone === "1", displayMode: displayMode === "simple" ? "simple" : "standard",
        themeMode: themeMode === "light" || themeMode === "dark" ? themeMode : "auto", hapticsEnabled: haptics !== "0" });
    } catch (error) {
      if (!isCurrent()) return;
      setLocalReadError(error instanceof Error ? error.message : "暂时无法读取本机资料。");
      throw error;
    }
  }, [consentRef, credentialsRef, destGenRef, familyIdRef, userIdRef]);

  const setHome = useCallback((home: MobileHome | null) => setSnapshot(current => ({ ...current, home })), []);
  const setSyncConsentState = useCallback((syncConsent: SyncConsent | null) => {
    ++readRevision.current;
    consentRef.current = syncConsent;
    setSnapshot(current => ({ ...current, syncConsent }));
  }, [consentRef]);
  const setWelcomeSeen = useCallback(async () => {
    await setMeta("welcome_done", "1");
    ++readRevision.current;
    setSnapshot(current => ({ ...current, welcomeSeen: true }));
  }, []);
  const setDisplayMode = useCallback(async (displayMode: "standard" | "simple") => {
    await setMeta("display_mode", displayMode);
    ++readRevision.current;
    setSnapshot(current => ({ ...current, displayMode }));
  }, []);
  const setThemeMode = useCallback(async (themeMode: ThemeMode) => {
    await setMeta("theme_mode", themeMode);
    ++readRevision.current;
    setSnapshot(current => ({ ...current, themeMode }));
  }, []);
  const setHapticsEnabled = useCallback(async (hapticsEnabled: boolean) => {
    await setMeta("haptics_enabled", hapticsEnabled ? "1" : "0");
    ++readRevision.current;
    applyHapticsEnabled(hapticsEnabled);
    setSnapshot(current => ({ ...current, hapticsEnabled }));
  }, []);

  return { ...snapshot, localReadError, reloadLocal, setHome, setSyncConsentState,
    setWelcomeSeen, setDisplayMode, setThemeMode, setHapticsEnabled };
}
