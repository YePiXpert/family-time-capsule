import { getServerCacheRevision } from "../storage/cache-lifecycle";
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
import type { ThemeMode } from "../theme";
import {
  fetchBootstrap,
  fetchMobileHome,
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
  clearLocalArchive,
  clearServerCaches,
  deleteLocalCaptureRecord,
  getActiveDestination,
  getCachedFamily,
  getCachedMobileHome,
  getCachedViewer,
  getMeta,
  getSyncConsent,
  listCachedPeople,
  listOutbox,
  listTimeline,
  removeOutboxItem,
  setActiveDestination,
  setMeta,
  setSyncConsent,
} from "../storage/database";
import { clearLocalFiles, removeLocalFile } from "../storage/files";
import { memoryCacheScope } from "../memories/cache-scope";
import { syncArchive } from "../sync/sync";
import { drainNativeShareIntake } from "../native/intake";
import { subscribeToPendingNativeShares } from "../../modules/share-intake/src";
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
  SyncConsent,
  Viewer,
} from "../types";
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
  /** 设备级显示偏好（标准/大字简洁）；null 表示还在读取。切换账号不改变它。 */
  displayMode: "standard" | "simple" | null;
  setDisplayMode: (mode: "standard" | "simple") => Promise<void>;
  /** 设备级外观偏好（跟随系统/浅色/深色）；null 表示还在读取。 */
  themeMode: ThemeMode | null;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  /** 账号已建立但尚未建立/绑定家庭：登录不算失败，应继续初始化。 */
  needsOnboarding: boolean;
  /** 当前目的地的同步授权；null 表示尚未授权（有待传记录时会弹出授权门）。 */
  syncConsent: SyncConsent | null;
  awaitingSyncConsent: boolean;
  userId: string | null;
  reloadLocal: () => Promise<void>;
  runSync: () => Promise<void>;
  queued: () => Promise<void>;
  connect: (credentials: Credentials) => Promise<void>;
  disconnect: () => Promise<void>;
  setWelcomeSeen: () => Promise<void>;
  completeOnboarding: (input: OnboardingInput) => Promise<void>;
  /** 授权上传目的地：scope all/selected/local（M4）。 */
  grantSyncConsent: (
    scope: SyncConsent["scope"],
    ids?: string[],
  ) => Promise<void>;
  /** 仅保留在本机：移除待传项，保留记录与原件。 */
  keepOutboxItemLocal: (itemId: string) => Promise<void>;
  /** 彻底删除一条本机记录（含原件），调用方必须先取得明确确认。 */
  deleteOutboxCapture: (item: OutboxItem) => Promise<void>;
  clearLocal: () => Promise<void>;
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
  const [displayMode, setDisplayModeState] = useState<"standard" | "simple" | null>(null);
  const [themeMode, setThemeModeState] = useState<ThemeMode | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [syncConsent, setSyncConsentState] = useState<SyncConsent | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [accountFamilyId, setAccountFamilyId] = useState<string | null>(null);
  const syncInFlight = useRef(false);
  const intakeInFlight = useRef(false);
  const intakeAgain = useRef(false);
  const clearingLocal = useRef(false);
  const needsOnboardingRef = useRef(false);
  const consentRef = useRef<SyncConsent | null>(null);
  const userIdRef = useRef<string | null>(null);
  const familyIdRef = useRef<string | null>(null);
  const destGenRef = useRef(0);
  const connecting = useRef(false);
  const credentialsRef = useRef(initialCredentials);
  const syncDone = useRef<Promise<void> | null>(null);
  const intakeDone = useRef<Promise<void> | null>(null);

  const reloadLocal = useCallback(async () => {
    const generation = destGenRef.current;
    const cacheScope = memoryCacheScope(credentialsRef.current, userIdRef.current ?? undefined, familyIdRef.current ?? undefined);
    const currentCredentials = credentialsRef.current;
    const draftScope = currentCredentials ? (currentCredentials.instanceId && userIdRef.current && familyIdRef.current
      ? JSON.stringify([currentCredentials.serverUrl, currentCredentials.instanceId, userIdRef.current, familyIdRef.current]) : null) : "local";
    const [
      nextEvents,
      nextFamily,
      nextViewer,
      nextPeople,
      nextOutbox,
      nextSyncAt,
      cachedHome,
      welcomeDone,
      consent,
      displayModeValue,
      themeModeValue,
    ] = await Promise.all([
      listTimeline(cacheScope, draftScope),
      getCachedFamily(),
      getCachedViewer(),
      listCachedPeople(cacheScope),
      listOutbox(),
      getMeta("last_sync_at"),
      getCachedMobileHome(),
      getMeta("welcome_done"),
      getSyncConsent(),
      getMeta("display_mode"),
      getMeta("theme_mode"),
    ]);
    if (generation !== destGenRef.current) return;
    setEvents(nextEvents);
    setFamily(nextFamily);
    setViewer(nextViewer);
    setPeople(nextPeople);
    setOutbox(nextOutbox);
    setLastSyncAt(nextSyncAt);
    setHome(cachedHome);
    setWelcomeSeenState(welcomeDone === "1");
    setDisplayModeState(displayModeValue === "simple" ? "simple" : "standard");
    setThemeModeState(themeModeValue === "light" || themeModeValue === "dark" ? themeModeValue : "auto");
    consentRef.current = consent;
    setSyncConsentState(consent);
  }, []);

  /** Only called after verifying the configured instance, before each upload pass. */
  const refreshAccount = useCallback(async (activeCredentials: Credentials) => {
    const generation = destGenRef.current;
    const me: MobileMe = await fetchMe(activeCredentials);
    if (generation !== destGenRef.current || activeCredentials !== credentialsRef.current) return null;
    if (me.status === "revoked") throw new ApiError("当前账号授权已撤回，请重新连接。", 403);
    const nextFamilyId = me.status === "ready" ? me.family.id : null;
    const destination = JSON.stringify([activeCredentials.serverUrl, activeCredentials.instanceId, me.user.id, nextFamilyId]);
    const previous = await getActiveDestination();
    if (generation !== destGenRef.current) return null;
    if (previous !== destination) {
      await clearServerCaches();
      await setActiveDestination(destination);
      if (generation !== destGenRef.current) return null;
      await reloadLocal();
    }
    userIdRef.current = me.user.id; setUserId(me.user.id);
    familyIdRef.current = nextFamilyId; setAccountFamilyId(nextFamilyId);
    needsOnboardingRef.current = me.status === "needsOnboarding";
    setNeedsOnboarding(needsOnboardingRef.current);
    if (me.status === "needsOnboarding") setMessage("账号已建立，请先完成家庭初始化。");
    return me;
  }, [reloadLocal]);

  /**
   * 上传授权门（M4）：没有针对当前目的地（serverUrl + 账号）的明确同意时，
   * 任何待传项都不上传；家庭资料下载不受影响。
   */
  const authorizeUpload = useCallback((item: OutboxItem): boolean => {
    const consent = consentRef.current;
    const activeUser = userIdRef.current;
    const credentials = credentialsRef.current;
    if (!consent || !activeUser || !credentials?.instanceId || connecting.current) return false;
    if (consent.instanceId !== credentials.instanceId || consent.familyId !== familyIdRef.current) return false;
    if (consent.serverUrl !== credentials.serverUrl) return false;
    if (consent.userId !== activeUser) return false;
    if (consent.scope === "all") return true;
    if (consent.scope === "selected") return consent.ids.includes(item.id);
    return false;
  }, []);

  const refreshHome = useCallback(async (activeCredentials: Credentials) => {
    const generation = destGenRef.current;
    const cacheRevision = getServerCacheRevision();
    const nextHome = await fetchMobileHome(activeCredentials);
    if (generation !== destGenRef.current) return;
    if (!await cacheMobileHome(nextHome, cacheRevision)) return;
    if (generation !== destGenRef.current) return;
    setHome(nextHome);
    void revalidateReadingDownloads(activeCredentials).catch(() => {});

  }, []);

  const runSync = useCallback(async () => {
    if (!credentials || credentials !== credentialsRef.current || syncInFlight.current || clearingLocal.current || connecting.current) return;
    syncInFlight.current = true;
    const generation = destGenRef.current;
    let finish!: () => void;
    syncDone.current = new Promise<void>((resolve) => { finish = resolve; });
    setSyncing(true);
    setMessage(null);
    let activeCredentials = credentials;
    try {
      const bootstrap = await fetchBootstrap(credentials.serverUrl);
      if (generation !== destGenRef.current) return;
      if (credentials.instanceId && credentials.instanceId !== bootstrap.info.instanceId) {
        destGenRef.current++;
        credentialsRef.current = null; setCredentials(null);
        userIdRef.current = null; setUserId(null);
        familyIdRef.current = null; setAccountFamilyId(null);
        await clearCredentials(); await clearServerCaches(); await reloadLocal();
        setMessage("这个地址的服务器实例已变化，请重新连接并核对家庭。本机原件仍保留。");
        return;
      }
      if (!credentials.instanceId) {
        const verifiedCredentials = { ...credentials, instanceId: bootstrap.info.instanceId };
        await saveCredentials(verifiedCredentials);
        if (generation !== destGenRef.current) return;
        credentialsRef.current = verifiedCredentials; setCredentials(verifiedCredentials);
        activeCredentials = verifiedCredentials;
      }
      const me = await refreshAccount(activeCredentials);
      if (!me || me.status !== "ready" || generation !== destGenRef.current) return;
      const summary = await syncArchive(activeCredentials, {
        isCurrent: () => generation === destGenRef.current && activeCredentials === credentialsRef.current,
        authorizeUpload: (item) => Promise.resolve(authorizeUpload(item)),
        onCacheReset: reloadLocal,
      });
      // 同步期间切换了连接：丢弃旧目的地的结果，不写新视图的缓存。
      if (generation !== destGenRef.current) return;
      try {
        await refreshHome(activeCredentials);
        if (generation !== destGenRef.current) return;
      } catch {
        // A committed timeline remains useful if this optional dashboard read fails.
      }
      const uploaded = summary.uploadedCount > 0 ? `，补传 ${summary.uploadedCount} 条` : "";
      const retained = summary.failedCount > 0
        ? `；${summary.failedCount} 条未被接受，仍在本机`
        : "";
      const skipped = summary.skippedUploadCount > 0
        ? `；${summary.skippedUploadCount} 条按你的选择保留在本机`
        : "";
      setMessage(`已同步 ${summary.eventCount} 段回忆${uploaded}${retained}${skipped}。`);
    } catch (error) {
      if (generation !== destGenRef.current) return;
      // 无家庭绑定的账号在此被服务端拒绝（401）；用 /me 区分“待初始化”
      // 与“会话失效”，避免把新账号误报成登录已过期。
      const status = error instanceof ApiError ? error.status : -1;
      if (status === 401) {
        await refreshAccount(activeCredentials).catch(() => null);
        if (generation !== destGenRef.current) return;
        if (needsOnboardingRef.current) {
          await reloadLocal();
          return;
        }
      }
      if (status === 401 || status === 403) {
        userIdRef.current = null; setUserId(null);
        familyIdRef.current = null; setAccountFamilyId(null);
        await clearServerCaches();
        if (generation !== destGenRef.current) return;
      }
      setMessage(error instanceof Error ? error.message : "同步失败，本机资料不受影响。");
    } finally {
      try {
        if (generation === destGenRef.current) await reloadLocal();
      } finally {
        setSyncing(false);
        syncInFlight.current = false;
        syncDone.current = null;
        finish();
      }
    }
  }, [authorizeUpload, credentials, refreshAccount, refreshHome, reloadLocal]);

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
        const scope = await getActiveDestination() ?? "local";
        const result = await drainNativeShareIntake(scope);
        if (result.manifests === 0 && !result.recovered && !result.recoveryPending) continue;
        await reloadLocal();
        const recoveryNotice = `${result.recovered ? `已找回 ${result.recovered} 份本机资料，尚未上传。` : ""}${result.recoveryPending ? `有 ${result.recoveryPending} 份旧资料暂时无法打开，请核对本机文件。` : ""}`;
        const failed = result.failed > 0 ? ` ${result.failed} 项复制失败，请打开收件核对。` : "";
        setMessage(`${result.manifests ? "分享内容已保存在本机。打开“收到的内容”，可加入草稿或仅存资料库。" : ""}${failed}${recoveryNotice}`);

      } while (intakeAgain.current && !clearingLocal.current);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "系统分享仍保留在本机，稍后会再次接管。");
    } finally {
      intakeInFlight.current = false;
      intakeDone.current = null;
      finish();
    }
  }, [reloadLocal]);

  /**
   * 连接（或切换）一个目的地：记录目的地标识；切换实例/账号时先清掉
   * 旧目的地的服务器缓存，绝不把 A 家庭的缓存泄露给 B 连接。
   */
  const connect = useCallback(async (nextCredentials: Credentials) => {
    if (clearingLocal.current || connecting.current) throw new Error("正在完成上一次连接操作，请稍后再试。");
    connecting.current = true;
    const generation = ++destGenRef.current;
    try {
      const { serverUrl, info } = await fetchBootstrap(nextCredentials.serverUrl);
      const verified = { ...nextCredentials, serverUrl, instanceId: info.instanceId };
      const me = await fetchMe(verified);
      if (me.status === "revoked") throw new ApiError("当前账号授权已撤回，请重新连接。", 403);
      // All old writes must finish before clearing caches and activating B.
      await syncDone.current;
      if (generation !== destGenRef.current) return;
      const destination = JSON.stringify([serverUrl, info.instanceId, me.user.id, me.status === "ready" ? me.family.id : null]);
      const previous = await getActiveDestination();
      if (previous !== destination) await clearServerCaches();
      try {
        await setActiveDestination(destination);
        await saveCredentials(verified);
      } catch (error) {
        credentialsRef.current = null; setCredentials(null);
        await clearCredentials();
        await reloadLocal();
        throw error;
      }
      userIdRef.current = me.user.id; setUserId(me.user.id);
      familyIdRef.current = me.status === "ready" ? me.family.id : null;
      setAccountFamilyId(familyIdRef.current);
      needsOnboardingRef.current = me.status === "needsOnboarding";
      setNeedsOnboarding(needsOnboardingRef.current);
      credentialsRef.current = verified; setCredentials(verified);
      await reloadLocal();
    } finally { connecting.current = false; }
  }, [reloadLocal]);

  const disconnect = useCallback(async () => {
    if (clearingLocal.current || connecting.current) throw new Error("正在完成连接或清理操作，请稍后再试。");
    connecting.current = true;
    destGenRef.current += 1;
    const previous = credentialsRef.current;
    credentialsRef.current = null; setCredentials(null);
    try {
      await syncDone.current;
      await clearCredentials();
      if (previous) await signOut(previous);
      needsOnboardingRef.current = false; setNeedsOnboarding(false);
      userIdRef.current = null; setUserId(null);
      familyIdRef.current = null; setAccountFamilyId(null);
      setMessage("已断开服务器，本机资料保持不变。");
    } finally { connecting.current = false; }
  }, []);

  const setWelcomeSeen = useCallback(async () => {
    await setMeta("welcome_done", "1");
    setWelcomeSeenState(true);
  }, []);

  /** 设备级显示偏好：只写本机 meta，不进入任何账号/家庭状态。 */
  const setDisplayMode = useCallback(async (mode: "standard" | "simple") => {
    await setMeta("display_mode", mode);
    setDisplayModeState(mode);
  }, []);

  /** 设备级外观偏好：只写本机 meta，不进入任何账号/家庭状态。 */
  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    await setMeta("theme_mode", mode);
    setThemeModeState(mode);
  }, []);

  /** App 内建立家庭；成功后立即开始第一次同步。 */
  const completeOnboarding = useCallback(async (input: OnboardingInput) => {
    if (!credentials || connecting.current) throw new Error("尚未登录或正在切换连接。");
    const generation = destGenRef.current;
    await submitOnboarding(credentials, input);
    if (generation !== destGenRef.current) return;
    needsOnboardingRef.current = false;
    setNeedsOnboarding(false);
    setMessage("家庭已建立，开始同步家庭资料。");
    await runSync();
  }, [credentials, runSync]);

  /** 记录用户对当前目的地的上传授权（M4）。 */
  const grantSyncConsent = useCallback(async (
    scope: SyncConsent["scope"],
    ids?: string[],
  ) => {
    const generation = destGenRef.current;
    if (connecting.current || credentials !== credentialsRef.current || !credentials?.instanceId || !userIdRef.current || !familyIdRef.current) { setMessage("请先联网核对实例、账号与家庭，再授权同步。"); return; }
    const consent: SyncConsent = {
      instanceId: credentials.instanceId,
      serverUrl: credentials.serverUrl,
      userId: userIdRef.current ?? "",
      familyId: familyIdRef.current,
      scope,
      ids: scope === "selected" ? (ids ?? []) : [],
      decidedAt: new Date().toISOString(),
    };
    await setSyncConsent(consent);
    if (generation !== destGenRef.current) return;
    consentRef.current = consent;
    setSyncConsentState(consent);
    setMessage(
      scope === "local"
        ? "已选择仅保留本机；这些记录不会上传，原件不受影响。"
        : "已同意向该家庭同步本机记录。",
    );
    if (scope !== "local") await runSync();
  }, [credentials, runSync]);

  /** 仅保留在本机：移除待传队列项，保留记录与原件。 */
  const keepItemLocal = useCallback(async (itemId: string) => {
    await removeOutboxItem(itemId);
    await reloadLocal();
    setMessage("这条记录已改为仅保留本机；原件没有被删除。");
  }, [reloadLocal]);

  /** 彻底删除一条本机记录（含原件）；调用方必须已经取得明确确认。 */
  const deleteOutboxCapture = useCallback(async (item: OutboxItem) => {
    await deleteLocalCaptureRecord(item.id);
    if (item.kind === "media_capture") {
      removeLocalFile((item.payload as MediaCapturePayload).localUri);
    }
    await reloadLocal();
    setMessage("这条本机记录及其原件已删除。");
  }, [reloadLocal]);

  const clearLocal = useCallback(async () => {
    if (clearingLocal.current) return;
    if (connecting.current) { setMessage("正在完成连接操作，请稍后再清理。"); return; }
    clearingLocal.current = true;
    destGenRef.current++;
    setSyncing(true);
    try {
      // Let already-started archive/intake writes settle before erasing their
      // results. The reading reset aborts transfers and drains identity writes.
      await Promise.all([syncDone.current, intakeDone.current]);
      if (credentials) await signOut(credentials);
      await clearAllReadingDownloads();
      await Promise.all([clearCredentials(), clearLocalArchive()]);
      clearLocalFiles();
      credentialsRef.current = null; setCredentials(null);
      needsOnboardingRef.current = false;
      setNeedsOnboarding(false);
      userIdRef.current = null;
      setUserId(null);
      familyIdRef.current = null; setAccountFamilyId(null);
      consentRef.current = null;
      setSyncConsentState(null);
      await reloadLocal();
      setMessage("本机资料已清除。");
    } catch (error) {
      setMessage(error instanceof Error ? `清理未完成：${error.message}` : "清理未完成，请重试。");
    } finally {
      clearingLocal.current = false;
      setSyncing(false);
    }
  }, [credentials, reloadLocal]);

  useEffect(() => {
    const generation = destGenRef.current;
    let active = true;
    const timer = setTimeout(() => {
      void reloadLocal().then(async () => {
        if (!active || generation !== destGenRef.current || !credentials || needsOnboardingRef.current || connecting.current) return;
        // The sync path verifies the instance and current account before uploading.
        await runSync();
      });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [credentials, reloadLocal, runSync]);

  useEffect(() => {
    const timer = setTimeout(() => void receiveSystemShares(), 0);
    return () => clearTimeout(timer);
  }, [receiveSystemShares]);

  useEffect(() => subscribeToPendingNativeShares(() => {
    void receiveSystemShares();
  }), [receiveSystemShares]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void receiveSystemShares().then(async () => {
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

  /**
   * 授权门（M4，派生值）：有待传记录、账号就绪，且当前目的地
   * （serverUrl + 账号）没有匹配的授权时显示授权界面。
   */
  const awaitingSyncConsent = useMemo(() => {
    if (!credentials || needsOnboarding || !userId || outbox.length === 0) {
      return false;
    }
    return !(
      syncConsent !== null &&
      syncConsent.serverUrl === credentials.serverUrl &&
      syncConsent.userId === userId &&
      Boolean(credentials.instanceId) && syncConsent.instanceId === credentials.instanceId &&
      syncConsent.familyId === accountFamilyId
    );
  }, [accountFamilyId, credentials, needsOnboarding, outbox.length, syncConsent, userId]);

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
    displayMode,
    themeMode,
    needsOnboarding,
    syncConsent,
    awaitingSyncConsent,
    userId,
    reloadLocal,
    runSync,
    queued,
    connect,
    disconnect,
    setWelcomeSeen,
    setDisplayMode,
    setThemeMode,
    completeOnboarding,
    grantSyncConsent,
    keepOutboxItemLocal: keepItemLocal,
    deleteOutboxCapture,
    clearLocal,
    dismissMessage: () => setMessage(null),
  }), [
    awaitingSyncConsent, clearLocal, completeOnboarding, connect, credentials,
    deleteOutboxCapture, disconnect, displayMode, events, family, grantSyncConsent,
    home, keepItemLocal, lastSyncAt, message, needsOnboarding, network.isConnected,
    outbox, people, queued, reloadLocal, runSync, setDisplayMode, setThemeMode, setWelcomeSeen,
    syncConsent, syncing, themeMode, userId, viewer, welcomeSeen,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("AppProvider is missing");
  return value;
}
