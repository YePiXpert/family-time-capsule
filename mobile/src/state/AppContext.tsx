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
  fetchMobileReview,
  fetchMe,
  signOut,
  submitOnboarding,
  ApiError,
} from "../api/client";
import {
  clearCredentials,
  saveCredentials,
} from "../auth/credentials";
import {
  cacheMobileHome,
  cacheMobileReview,
  clearLocalArchive,
  getCachedFamily,
  getCachedMobileHome,
  getCachedViewer,
  getMeta,
  listCachedPeople,
  listOutbox,
  listTimeline,
  removeOutboxItem,
  setMeta,
} from "../storage/database";
import { clearLocalFiles, removeLocalFile } from "../storage/files";
import { syncArchive } from "../sync/sync";
import { drainNativeShareIntake } from "../native/intake";
import { subscribeToPendingNativeShares } from "../../modules/share-intake/src";
import { resolveNativeCaptureAccess } from "../authz/product-access";
import type {
  Credentials,
  Family,
  LocalTimelineEvent,
  MediaCapturePayload,
  MobileHome,
  MobileMe,
  OnboardingInput,
  OutboxItem,
  Person,
  Viewer,
} from "../types";
import { reconcileWeeklyReviewReminder } from "../notifications/review-reminders";
import { clearAllReadingDownloads, revalidateReadingDownloads } from "../reading/native";

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
  /** 首次欢迎页是否已处理：null 表示还在读取本机状态。 */
  welcomeSeen: boolean | null;
  /** 账号已建立但尚未建立/绑定家庭：登录不算失败，应继续初始化。 */
  needsOnboarding: boolean;
  reloadLocal: () => Promise<void>;
  runSync: () => Promise<void>;
  queued: () => Promise<void>;
  connect: (credentials: Credentials) => Promise<void>;
  disconnect: () => Promise<void>;
  setWelcomeSeen: () => Promise<void>;
  completeOnboarding: (input: OnboardingInput) => Promise<void>;
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
  const [welcomeSeen, setWelcomeSeenState] = useState<boolean | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const syncInFlight = useRef(false);
  const intakeInFlight = useRef(false);
  const intakeAgain = useRef(false);
  const clearingLocal = useRef(false);
  const needsOnboardingRef = useRef(false);
  const syncDone = useRef<Promise<void> | null>(null);
  const intakeDone = useRef<Promise<void> | null>(null);

  const reloadLocal = useCallback(async () => {
    const [nextEvents, nextFamily, nextViewer, nextPeople, nextOutbox, nextSyncAt, cachedHome, welcomeDone] =
      await Promise.all([
        listTimeline(),
        getCachedFamily(),
        getCachedViewer(),
        listCachedPeople(),
        listOutbox(),
        getMeta("last_sync_at"),
        getCachedMobileHome(),
        getMeta("welcome_done"),
      ]);
    setEvents(nextEvents);
    setFamily(nextFamily);
    setViewer(nextViewer);
    setPeople(nextPeople);
    setOutbox(nextOutbox);
    setLastSyncAt(nextSyncAt);
    setHome(cachedHome);
    setWelcomeSeenState(welcomeDone === "1");
  }, []);

  /** 刷新账号与家庭状态；needsOnboarding 时暂停自动同步，等待用户建家庭。 */
  const refreshAccount = useCallback(async (activeCredentials: Credentials) => {
    try {
      const me: MobileMe = await fetchMe(activeCredentials);
      const pending = me.status === "needsOnboarding";
      if (pending !== needsOnboardingRef.current) {
        needsOnboardingRef.current = pending;
        setNeedsOnboarding(pending);
      }
      if (pending) {
        setMessage("账号已建立，请先完成家庭初始化。");
      }
    } catch {
      // 网络或会话问题时维持现状：同步路径已有各自的错误提示。
    }
  }, []);

  const refreshHome = useCallback(async (activeCredentials: Credentials) => {
    const nextHome = await fetchMobileHome(activeCredentials);
    await cacheMobileHome(nextHome);
    setHome(nextHome);
    void revalidateReadingDownloads(activeCredentials).catch(() => {});
    try {
      const review = await fetchMobileReview(activeCredentials);
      await cacheMobileReview(review);
      await reconcileWeeklyReviewReminder(review);
    } catch {
      // Review is an independent versioned snapshot; retain its last cache if
      // the endpoint is temporarily unavailable or the server is still 1.0.
    }
  }, []);

  const runSync = useCallback(async () => {
    if (!credentials || syncInFlight.current || clearingLocal.current) return;
    syncInFlight.current = true;
    let finish!: () => void;
    syncDone.current = new Promise<void>((resolve) => { finish = resolve; });
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
      // 无家庭绑定的账号在此被服务端拒绝（401）；用 /me 区分“待初始化”
      // 与“会话失效”，避免把新账号误报成登录已过期。
      const status = error instanceof ApiError ? error.status : -1;
      if (status === 401) {
        await refreshAccount(credentials);
        if (needsOnboardingRef.current) {
          await reloadLocal();
          return;
        }
      }
      setMessage(error instanceof Error ? error.message : "同步失败，本机资料不受影响。");
    } finally {
      try {
        await reloadLocal();
      } finally {
        setSyncing(false);
        syncInFlight.current = false;
        syncDone.current = null;
        finish();
      }
    }
  }, [credentials, refreshAccount, refreshHome, reloadLocal]);

  /**
   * 保存完成即返回：只等待本机数据刷新，同步在后台单独运行。
   * 大视频的补传不会阻塞下一条文字的保存交互。
   */
  const queued = useCallback(async () => {
    await reloadLocal();
    if (credentials && !needsOnboardingRef.current && network.isConnected !== false) {
      void runSync().catch(() => {});
    }
  }, [credentials, network.isConnected, reloadLocal, runSync]);

  const receiveSystemShares = useCallback(async () => {
    if (clearingLocal.current) return;
    if (intakeInFlight.current) {
      intakeAgain.current = true;
      return;
    }
    intakeInFlight.current = true;
    let finish!: () => void;
    intakeDone.current = new Promise<void>((resolve) => { finish = resolve; });
    try {
      do {
        intakeAgain.current = false;
        const access = resolveNativeCaptureAccess(Boolean(credentials), viewer);
        const result = await drainNativeShareIntake(access !== "readonly");
        if (result.manifests === 0) continue;
        await reloadLocal();
        if (result.retainedReadonly > 0) {
          setMessage("已保全系统分享的本机副本；当前家庭角色只读，未创建待同步项目。");
        } else {
          const failed = result.failed > 0 ? `；${result.failed} 项复制失败，其他项目不受影响` : "";
          setMessage(`已接管 ${result.queued} 项系统分享并保存到本机${failed}。`);
          if (credentials && network.isConnected !== false && result.queued > 0) await runSync();
        }
      } while (intakeAgain.current && !clearingLocal.current);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "系统分享仍保留在本机，稍后会再次接管。");
    } finally {
      intakeInFlight.current = false;
      intakeDone.current = null;
      finish();
    }
  }, [credentials, network.isConnected, reloadLocal, runSync, viewer]);

  const connect = useCallback(async (nextCredentials: Credentials) => {
    if (clearingLocal.current) return;
    await saveCredentials(nextCredentials);
    setCredentials(nextCredentials);
    // 先判定账号是否还要建家庭，避免凭证一建立就触发注定失败的同步。
    await refreshAccount(nextCredentials);
  }, [refreshAccount]);

  const disconnect = useCallback(async () => {
    if (credentials) await signOut(credentials);
    await clearCredentials();
    setCredentials(null);
    needsOnboardingRef.current = false;
    setNeedsOnboarding(false);
    setMessage("已断开服务器，本机资料保持不变。");
  }, [credentials]);

  const setWelcomeSeen = useCallback(async () => {
    await setMeta("welcome_done", "1");
    setWelcomeSeenState(true);
  }, []);

  /** App 内建立家庭；成功后立即开始第一次同步。 */
  const completeOnboarding = useCallback(async (input: OnboardingInput) => {
    if (!credentials) throw new Error("尚未登录。");
    await submitOnboarding(credentials, input);
    needsOnboardingRef.current = false;
    setNeedsOnboarding(false);
    setMessage("家庭已建立，开始同步家庭资料。");
    await runSync();
  }, [credentials, runSync]);

  const clearLocal = useCallback(async () => {
    if (clearingLocal.current) return;
    clearingLocal.current = true;
    setSyncing(true);
    try {
      // Let already-started archive/intake writes settle before erasing their
      // results. The reading reset aborts transfers and drains identity writes.
      await Promise.all([syncDone.current, intakeDone.current]);
      if (credentials) await signOut(credentials);
      await clearAllReadingDownloads();
      await Promise.all([clearCredentials(), clearLocalArchive()]);
      clearLocalFiles();
      setCredentials(null);
      needsOnboardingRef.current = false;
      setNeedsOnboarding(false);
      await reloadLocal();
      setMessage("本机资料已清除。");
    } catch (error) {
      setMessage(error instanceof Error ? `清理未完成：${error.message}` : "清理未完成，请重试。");
    } finally {
      clearingLocal.current = false;
      setSyncing(false);
    }
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
      void reloadLocal().then(() =>
        credentials && !needsOnboardingRef.current ? runSync() : undefined,
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [credentials, reloadLocal, runSync]);

  useEffect(() => {
    const timer = setTimeout(() => void receiveSystemShares(), 0);
    return () => clearTimeout(timer);
  }, [receiveSystemShares]);

  useEffect(() => subscribeToPendingNativeShares(() => {
    void receiveSystemShares();
  }), [receiveSystemShares]);

  useEffect(() => {
    const timer = setTimeout(() => void reconcileWeeklyReviewReminder(), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void receiveSystemShares().then(async () => {
        await reconcileWeeklyReviewReminder();
        if (credentials && !needsOnboardingRef.current) await runSync();
      });
    });
    return () => subscription.remove();
  }, [credentials, receiveSystemShares, runSync]);

  useEffect(() => {
    const subscription = Network.addNetworkStateListener((state) => {
      if (credentials && !needsOnboardingRef.current && state.isConnected) void runSync();
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
    welcomeSeen,
    needsOnboarding,
    reloadLocal,
    runSync,
    queued,
    connect,
    disconnect,
    setWelcomeSeen,
    completeOnboarding,
    clearLocal,
    discardFailed,
    dismissMessage: () => setMessage(null),
  }), [
    clearLocal, completeOnboarding, connect, credentials, disconnect,
    discardFailed, events, family, home, lastSyncAt, message,
    needsOnboarding, network.isConnected, outbox, people, queued,
    reloadLocal, runSync, setWelcomeSeen, syncing, viewer, welcomeSeen,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("AppProvider is missing");
  return value;
}
