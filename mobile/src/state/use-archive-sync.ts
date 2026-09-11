import { useCallback, useRef, useState } from "react";
import { ApiError, fetchBootstrap, fetchMe, fetchMobileHome } from "../api/client";
import { clearCredentials, saveCredentials } from "../auth/credentials";
import { cacheMobileHome, clearServerCaches, getActiveDestination, setActiveDestination } from "../storage/database";
import { getServerCacheRevision } from "../storage/cache-lifecycle";
import { revalidateReadingDownloads } from "../reading/native";
import { syncArchive } from "../sync/sync";
import type { Credentials, MobileHome, MobileMe, OutboxItem } from "../types";
import type { AccountSession } from "./use-account-session";

type Options = {
  session: AccountSession;
  reloadLocal: () => Promise<void>;
  setHome: (home: MobileHome | null) => void;
  setMessage: (message: string | null) => void;
};

/** One upload pass at a time; verify identity and consent before every pass. */
export function useArchiveSync({ session, reloadLocal, setHome, setMessage }: Options) {
  const { credentials, credentialsRef, userIdRef, familyIdRef, needsOnboardingRef,
    consentRef, destGenRef, connectingRef, clearingLocalRef,
    setCredentials, setUserId, setAccountFamilyId, setNeedsOnboarding } = session;
  const syncInFlightRef = useRef(false);
  const syncDoneRef = useRef<Promise<void> | null>(null);
  const [syncing, setSyncing] = useState(false);
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
    setUserId(me.user.id);
    setAccountFamilyId(nextFamilyId);
    setNeedsOnboarding(me.status === "needsOnboarding");
    if (me.status === "needsOnboarding") setMessage("账号已建立，请先完成家庭初始化。");
    return me;
  }, [credentialsRef, destGenRef, reloadLocal, setAccountFamilyId, setMessage, setNeedsOnboarding, setUserId]);

  /**
   * 上传授权门（M4）：没有针对当前目的地（serverUrl + 账号）的明确同意时，
   * 任何待传项都不上传；家庭资料下载不受影响。
   */
  const authorizeUpload = useCallback((item: OutboxItem): boolean => {
    const consent = consentRef.current;
    const activeUser = userIdRef.current;
    const credentials = credentialsRef.current;
    if (!consent || !activeUser || !credentials?.instanceId || connectingRef.current) return false;
    if (consent.instanceId !== credentials.instanceId || consent.familyId !== familyIdRef.current) return false;
    if (consent.serverUrl !== credentials.serverUrl) return false;
    if (consent.userId !== activeUser) return false;
    if (consent.scope === "all") return true;
    if (consent.scope === "selected") return consent.ids.includes(item.id);
    return false;
  }, [connectingRef, consentRef, credentialsRef, familyIdRef, userIdRef]);

  const refreshHome = useCallback(async (activeCredentials: Credentials) => {
    const generation = destGenRef.current;
    const cacheRevision = getServerCacheRevision();
    const nextHome = await fetchMobileHome(activeCredentials);
    if (generation !== destGenRef.current) return;
    if (!await cacheMobileHome(nextHome, cacheRevision)) return;
    if (generation !== destGenRef.current) return;
    setHome(nextHome);
    void revalidateReadingDownloads(activeCredentials).catch(() => {});

  }, [destGenRef, setHome]);

  const runSync = useCallback(async () => {
    if (!credentials || credentials !== credentialsRef.current || syncInFlightRef.current || clearingLocalRef.current || connectingRef.current) return;
    syncInFlightRef.current = true;
    const generation = destGenRef.current;
    let finish!: () => void;
    syncDoneRef.current = new Promise<void>((resolve) => { finish = resolve; });
    setSyncing(true);
    setMessage(null);
    let activeCredentials = credentials;
    try {
      const bootstrap = await fetchBootstrap(credentials.serverUrl);
      if (generation !== destGenRef.current) return;
      if (credentials.instanceId && credentials.instanceId !== bootstrap.info.instanceId) {
        destGenRef.current++;
        setCredentials(null);
        setUserId(null);
        setAccountFamilyId(null);
        await clearCredentials(); await clearServerCaches(); await reloadLocal();
        setMessage("这个地址的服务器实例已变化，请重新连接并核对家庭。本机原件仍保留。");
        return;
      }
      if (!credentials.instanceId) {
        const verifiedCredentials = { ...credentials, instanceId: bootstrap.info.instanceId };
        await saveCredentials(verifiedCredentials);
        if (generation !== destGenRef.current) return;
        setCredentials(verifiedCredentials);
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
        setUserId(null);
        setAccountFamilyId(null);
        await clearServerCaches();
        if (generation !== destGenRef.current) return;
      }
      setMessage(error instanceof Error ? error.message : "同步失败，本机资料不受影响。");
    } finally {
      try {
        if (generation === destGenRef.current) await reloadLocal();
      } catch (error) {
        if (generation === destGenRef.current) setMessage(error instanceof Error ? error.message : "暂时无法读取本机资料，请重试。");
      } finally {
        setSyncing(false);
        syncInFlightRef.current = false;
        syncDoneRef.current = null;
        finish();
      }
    }
  }, [authorizeUpload, clearingLocalRef, connectingRef, credentials, credentialsRef, destGenRef, needsOnboardingRef, refreshAccount, refreshHome, reloadLocal, setAccountFamilyId, setCredentials, setMessage, setUserId]);

  return { runSync, syncing, setSyncing, syncDoneRef };
}
