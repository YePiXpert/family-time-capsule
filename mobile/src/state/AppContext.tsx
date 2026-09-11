import type { AppContextValue } from "./contracts";
import { useLocalArchive } from "./use-local-archive";
import { useShareIntake } from "./use-share-intake";
import { useAppLifecycle } from "./use-app-lifecycle";
import { useAccountSession } from "./use-account-session";
import { useArchiveSync } from "./use-archive-sync";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import * as Network from "expo-network";
import {
  fetchBootstrap,
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
  clearLocalArchive,
  clearServerCaches,
  deleteLocalCaptureRecord,
  getActiveDestination,
  removeOutboxItem,
  setActiveDestination,
  setSyncConsent,
} from "../storage/database";
import { clearLocalFiles, removeLocalFile } from "../storage/files";
import type {
  Credentials,
  MediaCapturePayload,
  OnboardingInput,
  OutboxItem,
  SyncConsent,
} from "../types";
import { clearAllReadingDownloads } from "../reading/native";


const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  initialCredentials,
  children,
}: PropsWithChildren<{ initialCredentials: Credentials | null }>) {
  const network = Network.useNetworkState();
  const session = useAccountSession(initialCredentials);
  const { credentials, userId, accountFamilyId, needsOnboarding,
    credentialsRef, userIdRef, familyIdRef, needsOnboardingRef, consentRef,
    destGenRef, connectingRef, clearingLocalRef,
    setCredentials, setUserId, setAccountFamilyId, setNeedsOnboarding } = session;
  const [message, setMessage] = useState<string | null>(null);
  const intakeDoneRef = useRef<Promise<void> | null>(null);

  const {
    family, viewer, people, events, outbox, home, lastSyncAt, welcomeSeen,
    displayMode, themeMode, hapticsEnabled, syncConsent, localReadError,
    reloadLocal, setHome, setSyncConsentState,
    setWelcomeSeen, setDisplayMode, setThemeMode, setHapticsEnabled,
  } = useLocalArchive({ credentialsRef, userIdRef, familyIdRef, destGenRef, consentRef });

  const { runSync, syncing, setSyncing, syncDoneRef } = useArchiveSync({ session, reloadLocal, setHome, setMessage });

  /**
   * 保存完成即返回：只等待本机数据刷新，同步在后台单独运行。
   * 大视频的补传不会阻塞下一条文字的保存交互。
   */
  const queued = useCallback(async () => {
    await reloadLocal();
    if (credentials && !needsOnboardingRef.current && network.isConnected !== false) {
      void runSync().catch(() => {});
    }
  }, [credentials, needsOnboardingRef, network.isConnected, reloadLocal, runSync]);

  const receiveSystemShares = useShareIntake({ clearingLocalRef, intakeDoneRef, reloadLocal, setMessage });

  /**
   * 连接（或切换）一个目的地：记录目的地标识；切换实例/账号时先清掉
   * 旧目的地的服务器缓存，绝不把 A 家庭的缓存泄露给 B 连接。
   */
  const connect = useCallback(async (nextCredentials: Credentials) => {
    if (clearingLocalRef.current || connectingRef.current) throw new Error("正在完成上一次连接操作，请稍后再试。");
    connectingRef.current = true;
    const generation = ++destGenRef.current;
    try {
      const { serverUrl, info } = await fetchBootstrap(nextCredentials.serverUrl);
      const verified = { ...nextCredentials, serverUrl, instanceId: info.instanceId };
      const me = await fetchMe(verified);
      if (me.status === "revoked") throw new ApiError("当前账号授权已撤回，请重新连接。", 403);
      // All old writes must finish before clearing caches and activating B.
      await syncDoneRef.current;
      if (generation !== destGenRef.current) return;
      const destination = JSON.stringify([serverUrl, info.instanceId, me.user.id, me.status === "ready" ? me.family.id : null]);
      const previous = await getActiveDestination();
      if (previous !== destination) await clearServerCaches();
      try {
        await setActiveDestination(destination);
        await saveCredentials(verified);
      } catch (error) {
        setCredentials(null);
        await clearCredentials();
        await reloadLocal();
        throw error;
      }
      setUserId(me.user.id);
      setAccountFamilyId(me.status === "ready" ? me.family.id : null);
      setNeedsOnboarding(me.status === "needsOnboarding");
      setCredentials(verified);
      await reloadLocal();
    } finally { connectingRef.current = false; }
  }, [clearingLocalRef, connectingRef, destGenRef, reloadLocal, setAccountFamilyId, setCredentials, setNeedsOnboarding, setUserId, syncDoneRef]);

  const disconnect = useCallback(async () => {
    if (clearingLocalRef.current || connectingRef.current) throw new Error("正在完成连接或清理操作，请稍后再试。");
    connectingRef.current = true;
    destGenRef.current += 1;
    const previous = credentialsRef.current;
    setCredentials(null);
    try {
      await syncDoneRef.current;
      await clearCredentials();
      if (previous) await signOut(previous);
      setNeedsOnboarding(false);
      setUserId(null);
      setAccountFamilyId(null);
      setMessage("已断开服务器，本机资料保持不变。");
    } finally { connectingRef.current = false; }
  }, [clearingLocalRef, connectingRef, credentialsRef, destGenRef, setAccountFamilyId, setCredentials, setNeedsOnboarding, setUserId, syncDoneRef]);

  /** App 内建立家庭；成功后立即开始第一次同步。 */
  const completeOnboarding = useCallback(async (input: OnboardingInput) => {
    if (!credentials || connectingRef.current) throw new Error("尚未登录或正在切换连接。");
    const generation = destGenRef.current;
    await submitOnboarding(credentials, input);
    if (generation !== destGenRef.current) return;
    setNeedsOnboarding(false);
    setMessage("家庭已建立，开始同步家庭资料。");
    await runSync();
  }, [connectingRef, credentials, destGenRef, runSync, setNeedsOnboarding]);

  /** 记录用户对当前目的地的上传授权（M4）。 */
  const grantSyncConsent = useCallback(async (
    scope: SyncConsent["scope"],
    ids?: string[],
  ) => {
    const generation = destGenRef.current;
    if (connectingRef.current || credentials !== credentialsRef.current || !credentials?.instanceId || !userIdRef.current || !familyIdRef.current) { setMessage("请先联网核对实例、账号与家庭，再授权同步。"); return; }
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
  }, [connectingRef, consentRef, credentials, credentialsRef, destGenRef, familyIdRef, runSync, setSyncConsentState, userIdRef]);

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
    if (clearingLocalRef.current) return;
    if (connectingRef.current) { setMessage("正在完成连接操作，请稍后再清理。"); return; }
    clearingLocalRef.current = true;
    destGenRef.current++;
    setSyncing(true);
    try {
      // Let already-started archive/intake writes settle before erasing their
      // results. The reading reset aborts transfers and drains identity writes.
      await Promise.all([syncDoneRef.current, intakeDoneRef.current]);
      if (credentials) await signOut(credentials);
      await clearAllReadingDownloads();
      await Promise.all([clearCredentials(), clearLocalArchive()]);
      clearLocalFiles();
      setCredentials(null);
      setNeedsOnboarding(false);
      setUserId(null);
      setAccountFamilyId(null);
      consentRef.current = null;
      setSyncConsentState(null);
      await reloadLocal();
      setMessage("本机资料已清除。");
    } catch (error) {
      setMessage(error instanceof Error ? `清理未完成：${error.message}` : "清理未完成，请重试。");
    } finally {
      clearingLocalRef.current = false;
      setSyncing(false);
    }
  }, [clearingLocalRef, connectingRef, consentRef, credentials, destGenRef, reloadLocal, setAccountFamilyId, setCredentials, setNeedsOnboarding, setSyncConsentState, setSyncing, setUserId, syncDoneRef]);

  useAppLifecycle({ credentials, destGenRef, needsOnboardingRef, connectingRef,
    reloadLocal, runSync, receiveSystemShares, setMessage });

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
    localReadError,
    displayMode,
    themeMode,
    hapticsEnabled,
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
    setHapticsEnabled,
    completeOnboarding,
    grantSyncConsent,
    keepOutboxItemLocal: keepItemLocal,
    deleteOutboxCapture,
    clearLocal,
    dismissMessage: () => setMessage(null),
  }), [
    awaitingSyncConsent, clearLocal, completeOnboarding, connect, credentials,
    deleteOutboxCapture, disconnect, displayMode, events, family, grantSyncConsent,
    hapticsEnabled, home, keepItemLocal, lastSyncAt, localReadError, message, needsOnboarding, network.isConnected,
    outbox, people, queued, reloadLocal, runSync, setDisplayMode, setHapticsEnabled, setThemeMode, setWelcomeSeen,
    syncConsent, syncing, themeMode, userId, viewer, welcomeSeen,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("AppProvider is missing");
  return value;
}
