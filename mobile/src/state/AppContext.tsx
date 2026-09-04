import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";
import * as Network from "expo-network";
import {
  fetchMobileHome,
  signOut,
} from "../api/client";
import {
  clearCredentials,
  saveCredentials,
} from "../auth/credentials";
import {
  cacheMobileHome,
  clearLocalArchive,
  getCachedFamily,
  getCachedMobileHome,
  getCachedViewer,
  getMeta,
  listCachedPeople,
  listOutbox,
  listTimeline,
  removeOutboxItem,
} from "../storage/database";
import { clearLocalFiles, removeLocalFile } from "../storage/files";
import { syncArchive } from "../sync/sync";
import { drainNativeShareIntake } from "../native/intake";
import { resolveNativeCaptureAccess } from "../authz/product-access";
import type {
  Credentials,
  Family,
  LocalTimelineEvent,
  MediaCapturePayload,
  MobileHome,
  OutboxItem,
  Person,
  Viewer,
} from "../types";

type AppContextValue = {
  credentials: Credentials | null;
  family: Family | null;
  viewer: Viewer | null;
  people: Person[];
  events: LocalTimelineEvent[];
  outbox: OutboxItem[];
  home: MobileHome | null;
  lastSyncAt: string | null;
  online: boolean | null;
  syncing: boolean;
  message: string | null;
  reloadLocal: () => Promise<void>;
  runSync: () => Promise<void>;
  queued: () => Promise<void>;
  connect: (credentials: Credentials) => Promise<void>;
  disconnect: () => Promise<void>;
  clearLocal: () => Promise<void>;
  discardFailed: () => Promise<void>;
  dismissMessage: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  initialCredentials,
  children,
}: PropsWithChildren<{ initialCredentials: Credentials | null }>) {
  const network = Network.useNetworkState();
  const [credentials, setCredentials] = useState(initialCredentials);
  const [family, setFamily] = useState<Family | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [events, setEvents] = useState<LocalTimelineEvent[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [home, setHome] = useState<MobileHome | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const syncInFlight = useRef(false);
  const intakeInFlight = useRef(false);

  const reloadLocal = useCallback(async () => {
    const [nextEvents, nextFamily, nextViewer, nextPeople, nextOutbox, nextSyncAt, cachedHome] =
      await Promise.all([
        listTimeline(),
        getCachedFamily(),
        getCachedViewer(),
        listCachedPeople(),
        listOutbox(),
        getMeta("last_sync_at"),
        getCachedMobileHome(),
      ]);
    setEvents(nextEvents);
    setFamily(nextFamily);
    setViewer(nextViewer);
    setPeople(nextPeople);
    setOutbox(nextOutbox);
    setLastSyncAt(nextSyncAt);
    setHome(cachedHome);
  }, []);

  const refreshHome = useCallback(async (activeCredentials: Credentials) => {
    const nextHome = await fetchMobileHome(activeCredentials);
    await cacheMobileHome(nextHome);
    setHome(nextHome);
  }, []);

  const runSync = useCallback(async () => {
    if (!credentials || syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncing(true);
    setMessage(null);
    try {
      const summary = await syncArchive(credentials);
      try {
        await refreshHome(credentials);
      } catch {
        // A committed timeline remains useful if this optional dashboard read fails.
      }
      const uploaded = summary.uploadedCount > 0 ? `，补传 ${summary.uploadedCount} 条` : "";
      const retained = summary.failedCount > 0
        ? `；${summary.failedCount} 条未被接受，仍在本机`
        : "";
      setMessage(`已同步 ${summary.eventCount} 段回忆${uploaded}${retained}。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "同步失败，本机资料不受影响。");
    } finally {
      try {
        await reloadLocal();
      } finally {
        setSyncing(false);
        syncInFlight.current = false;
      }
    }
  }, [credentials, refreshHome, reloadLocal]);

  const queued = useCallback(async () => {
    await reloadLocal();
    if (credentials && network.isConnected !== false) await runSync();
  }, [credentials, network.isConnected, reloadLocal, runSync]);

  const receiveSystemShares = useCallback(async () => {
    if (intakeInFlight.current) return;
    intakeInFlight.current = true;
    try {
      const access = resolveNativeCaptureAccess(Boolean(credentials), viewer);
      const result = await drainNativeShareIntake(access !== "readonly");
      if (result.manifests === 0) return;
      await reloadLocal();
      if (result.retainedReadonly > 0) {
        setMessage("已保全系统分享的本机副本；当前家庭角色只读，未创建待同步项目。");
      } else {
        const failed = result.failed > 0 ? `；${result.failed} 项复制失败，其他项目不受影响` : "";
        setMessage(`已接管 ${result.queued} 项系统分享并保存到本机${failed}。`);
        if (credentials && network.isConnected !== false && result.queued > 0) await runSync();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "系统分享仍保留在本机，稍后会再次接管。");
    } finally {
      intakeInFlight.current = false;
    }
  }, [credentials, network.isConnected, reloadLocal, runSync, viewer]);

  const connect = useCallback(async (nextCredentials: Credentials) => {
    await saveCredentials(nextCredentials);
    setCredentials(nextCredentials);
  }, []);

  const disconnect = useCallback(async () => {
    if (credentials) await signOut(credentials);
    await clearCredentials();
    setCredentials(null);
    setMessage("已断开服务器，本机资料保持不变。");
  }, [credentials]);

  const clearLocal = useCallback(async () => {
    if (credentials) await signOut(credentials);
    await Promise.all([clearCredentials(), clearLocalArchive()]);
    clearLocalFiles();
    setCredentials(null);
    await reloadLocal();
    setMessage("本机资料已清除。");
  }, [credentials, reloadLocal]);

  const discardFailed = useCallback(async () => {
    for (const item of outbox.filter((entry) => entry.attemptCount > 0)) {
      await removeOutboxItem(item.id);
      if (item.kind === "media_capture") {
        removeLocalFile((item.payload as MediaCapturePayload).localUri);
      }
    }
    await reloadLocal();
  }, [outbox, reloadLocal]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void reloadLocal().then(() => (credentials ? runSync() : undefined));
    }, 0);
    return () => clearTimeout(timer);
  }, [credentials, reloadLocal, runSync]);

  useEffect(() => {
    const timer = setTimeout(() => void receiveSystemShares(), 0);
    return () => clearTimeout(timer);
  }, [receiveSystemShares]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void receiveSystemShares().then(() => (
        credentials ? runSync() : undefined
      ));
    });
    return () => subscription.remove();
  }, [credentials, receiveSystemShares, runSync]);

  useEffect(() => {
    const subscription = Network.addNetworkStateListener((state) => {
      if (credentials && state.isConnected) void runSync();
    });
    return () => subscription.remove();
  }, [credentials, runSync]);

  const value = useMemo<AppContextValue>(() => ({
    credentials,
    family,
    viewer,
    people,
    events,
    outbox,
    home,
    lastSyncAt,
    online: network.isConnected ?? null,
    syncing,
    message,
    reloadLocal,
    runSync,
    queued,
    connect,
    disconnect,
    clearLocal,
    discardFailed,
    dismissMessage: () => setMessage(null),
  }), [
    clearLocal, connect, credentials, disconnect, discardFailed, events,
    family, home, lastSyncAt, message, network.isConnected, outbox, people,
    queued, reloadLocal, runSync, syncing, viewer,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("AppProvider is missing");
  return value;
}
