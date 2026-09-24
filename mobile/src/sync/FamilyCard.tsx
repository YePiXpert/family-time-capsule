import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as LocalAuthentication from "expo-local-authentication";
import { getToken } from "../ai/session";
import { BackupStopped } from "../local/backup";
import { useLibrary, useStore, useSyncStatus } from "../local/context";
import { useNav } from "../local/navigation";
import {
  Button,
  Card,
  ErrorText,
  Text,
  dateLabel,
  messageOf,
  useStyles,
} from "../local/ui";
import { keyIdOf, newMasterKey } from "./crypto";
import { verifyRemoteBackup } from "./engine";
import { runFamilySync, joinFamily, leaveFamily } from "./family";
import { claimSync, markSyncRunning } from "./status";
import { dateTimeLabel } from "../local/dates";
import { bytesLabel } from "./planner";
import {
  clearSyncFiles,
  forgetKey,
  freshRemoteState,
  loadKey,
  readRemoteState,
  readConflicts,
  storeKey,
  writeRemoteState,
  type RemoteState,
  unreadNotice,
} from "./state";
import { SyncError, createTransport, type RemoteStatus } from "./transport";
/** 备份页最后一张卡：家人一起写的三态入口，进度与结果就地显示。
 * onRunningChange 与本机备份共用操作锁，避免同时读写 blob 库。
 */
export function FamilyCard({
  busy,
  onRunningChange,
}: {
  busy: boolean;
  onRunningChange?: (running: boolean) => void;
}) {
  const sync = useSyncStatus();
  const library = useLibrary(),
    store = useStore(),
    nav = useNav(),
    s = useStyles();
  // useState 槽位：signedIn、remote、progress、message、error、isOwner、conflicts、localKeyId、status、statusError。
  const [signedIn, setSignedIn] = useState<boolean | null>(null),
    [remote, setRemote] = useState<RemoteState | null>(null),
    [progress, setProgress] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [conflicts, setConflicts] = useState(0);
  const [localKeyId, setLocalKeyId] = useState<string | null>(null);
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    let cancelled = false;
    setIsOwner(false);
    setStatus(null);
    setStatusError("");
    setError("");
    void (async () => {
      try {
        const [token, state, items, key] = await Promise.all([
          getToken(),
          readRemoteState(),
          readConflicts(),
          loadKey(),
        ]);
        if (cancelled) return;
        setSignedIn(!!token);
        setRemote(state);
        setConflicts(items.length);
        setLocalKeyId(key ? keyIdOf(key) : null);
        if (token) {
          const transport = createTransport();
          await Promise.all([
            transport.me()
              .then((identity) => {
                if (!cancelled) setIsOwner(identity.role === "owner");
              })
              .catch((e: unknown) => {
                if (!cancelled) setError(messageOf(e));
              }),
            !state?.enabled
              ? transport.status()
                  .then((next) => {
                    if (!cancelled) setStatus(next);
                  })
                  .catch((e: unknown) => {
                    if (!cancelled) setStatusError(messageOf(e));
                  })
              : Promise.resolve(),
          ]);
        }
      } catch (e) {
        // 钥匙串读不出来：别让卡上的按钮全灰着不说话。
        if (cancelled) return;
        setSignedIn(false);
        setError(messageOf(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useFocusEffect(refresh);
  // 离开这一页就停止还在跑的同步：停止键跟着卡一起消失，不能让它在背后继续。
  useEffect(() => {
    const active = controller;
    return () => active.current?.abort();
  }, []);
  const running = !!progress;
  const syncing = running || sync.running;
  const perform = async (fn: (signal: AbortSignal) => Promise<void>) => {
    if (!claimSync()) {
      setMessage("正在同步，等它完成再试。");
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setError("");
    setMessage("");
    setProgress("正在准备…");
    onRunningChange?.(true);
    try {
      await fn(abort.signal);
    } catch (e) {
      // 「正在整理照片」阶段的停止来自本机备份（BackupStopped），之后的来自传输层。
      if (
        e instanceof BackupStopped ||
        (e instanceof SyncError && e.code === "CANCELED")
      )
        setMessage("已停止。");
      else setError(messageOf(e));
    } finally {
      markSyncRunning(false);
      controller.current = null;
      setProgress("");
      onRunningChange?.(false);
      try {
        setRemote(await readRemoteState());
        setConflicts((await readConflicts()).length);
      } catch (e) {
        setError(messageOf(e));
      }
    }
  };
  const withKey = async (
    signal: AbortSignal,
    fn: (key: Uint8Array, signal: AbortSignal) => Promise<void>,
  ) => {
    const key = await loadKey();
    if (!key)
      throw new Error("这台手机上没有一起写的钥匙，请用恢复码加入。");
    await fn(key, signal);
  };
  const syncNow = () =>
    perform((signal) =>
      withKey(signal, async (key) => {
        const result = await runFamilySync(store, {
          transport: createTransport(),
          key,
          onProgress: setProgress,
          signal,
        });
        const { pulled = 0, pushed = 0, conflicts = 0 } =
          result.lastSyncSummary ?? {};
        const parts = [
          pulled > 0 ? `从家人那里并入 ${pulled} 处改动` : "",
          pushed > 0 ? `往远端新传 ${pushed} 份` : "",
          conflicts > 0 ? `${conflicts} 段两台手机都改过` : "",
        ].filter(Boolean);
        setMessage(
          [
            pulled === 0 && pushed === 0 && conflicts === 0
              ? "已经是最新的了。"
              : `同步完成：${parts.join("，")}。`,
            unreadNotice(result.lastSyncSummary),
          ].join(""),
        );
      }),
    );
  const resume = () =>
    perform((signal) =>
      withKey(signal, async (key) => {
        const result = await joinFamily(store, key, {
          transport: createTransport(),
          onProgress: setProgress,
          signal,
        });
        setMessage(`已加入，同步完成。${unreadNotice(result.lastSyncSummary)}`);
      }),
    );
  const verify = () =>
    perform((signal) =>
      withKey(signal, async (key) => {
        const summary = await verifyRemoteBackup({
          transport: createTransport(),
          key,
          onProgress: setProgress,
          signal,
        });
        setMessage(
          `远端完整：${dateLabel(summary.createdAt)} 发布的这一份，${bytesLabel(summary.bytes)}，都在。`,
        );
      }),
    );
  const enable = () =>
    perform(async () => {
      const key = (await loadKey()) ?? newMasterKey();
      clearSyncFiles();
      await storeKey(key);
      writeRemoteState(freshRemoteState(keyIdOf(key)));
      nav.navigate("RecoveryCode", { mode: "show" });
    });
  const showCode = () =>
    perform(async () => {
      if (library.settings.lockEnabled) {
        let unlocked = false;
        try {
          unlocked = (
            await LocalAuthentication.authenticateAsync({
              promptMessage: "查看恢复码",
              cancelLabel: "取消",
            })
          ).success;
        } catch {
          // 设备没有可用的锁屏验证时不把主人锁在恢复码外面。
          unlocked = true;
        }
        if (!unlocked) return;
      }
      nav.navigate("RecoveryCode", { mode: "show" });
    });
  const disable = () =>
    Alert.alert(
      "退出家人一起写？",
      "这台手机会忘掉恢复码、不再同步；本机的时光和照片都留着。远端只撤下这台手机发布的那一份，家人的不受影响。退出前请确认恢复码已抄在纸上。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "退出",
          style: "destructive",
          onPress: () => {
            void perform(async (signal) => {
              const result = await leaveFamily({
                transport: createTransport(),
                signal,
              });
              setMessage(result.removedRemote
                ? "已退出，远端已撤下这台手机的那一份。"
                : "已退出。这台手机之前发布到远端的那一份暂时没撤下，不影响家人。");
              refresh();
            });
          },
        },
      ],
    );
  const wipeFamily = () =>
    Alert.alert(
      "删掉全家的远端？",
      "这会删除全家所有手机发布到远端的内容，这台手机也会退出、忘掉恢复码。各台手机本机的时光都还在；家人的手机再同步时会重新传上去，所以请先让家人都退出并抄好恢复码。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "删掉全家的远端",
          style: "destructive",
          onPress: () => {
            void perform(async (signal) => {
              await createTransport().wipeFamily(signal);
              await forgetKey();
              clearSyncFiles();
              setMessage("全家的远端已删除，这台手机已退出。");
              refresh();
            });
          },
        },
      ],
    );
  const stop = running && (
    <Button
      title="停止"
      kind="text"
      compact
      testID="remote-stop"
      onPress={() => controller.current?.abort()}
    />
  );
  return (
    <Card testID="remote-card">
      <Text style={s.heading}>家人一起写</Text>
      {signedIn === null ? (
        <Text style={s.muted}>正在读取…</Text>
      ) : signedIn === false ? (
        <>
          <Text style={s.muted}>
            登录家人账号后，几台手机可以一起写这本册子：每段时光都有落款，照片和文字加密后经家人服务同步，服务器看不到内容。
          </Text>
          <ErrorText message={error} />
          <View style={{ alignItems: "flex-start" }}>
            <Button
              title="去登录"
              kind="text"
              compact
              disabled={busy || syncing}
              onPress={() => nav.navigate("AISettings")}
            />
          </View>
        </>
      ) : !remote?.enabled ? (
        <>
          <Text style={s.muted}>
            一台服务就是一家人。加入后，这台手机的时光会与家人的合在一起，各自的草稿留在各自的手机上；换手机也是这样加入。
          </Text>
          <ErrorText message={error} />
          {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
          {statusError ? (
            <>
              <ErrorText message={statusError} />
              <Button
                title="再试一次"
                kind="text"
                disabled={busy || syncing}
                onPress={() => { refresh(); }}
              />
            </>
          ) : !status ? (
            !error && <Text style={s.muted}>正在看看家里有没有人在写…</Text>
          ) : (
            <View style={s.row}>
              {status.manifests > 0 ? (
                localKeyId && localKeyId === status.keyId ? (
                  <Button
                    title="继续一起写"
                    testID="remote-resume"
                    disabled={busy || syncing}
                    onPress={() => { void resume(); }}
                  />
                ) : (
                  <Button
                    title="加入"
                    testID="remote-join"
                    disabled={busy || syncing}
                    onPress={() => nav.navigate("RecoveryCode", { mode: "join" })}
                  />
                )
              ) : (
                <Button
                  title="开始一起写"
                  testID="remote-enable"
                  disabled={busy || syncing}
                  onPress={() => { void enable(); }}
                />
              )}
              {stop}
            </View>
          )}
        </>
      ) : (
        <>
          <Text style={s.muted}>
            {remote.lastSyncAt
              ? `上次同步 ${dateTimeLabel(remote.lastSyncAt)} · ${remote.lastSyncSummary?.devices ?? 1} 台手机 · ${bytesLabel(remote.lastSyncSummary?.bytes ?? 0)}`
              : "还没同步过。"}
          </Text>
          {!syncing && !!unreadNotice(remote.lastSyncSummary) && (
            <Text style={s.muted}>{unreadNotice(remote.lastSyncSummary)}</Text>
          )}
          <ErrorText message={error || (!syncing ? remote.lastError : "") || ""} />
          {conflicts > 0 && (
            <View style={s.between}>
              <Text>{`有 ${conflicts} 段两台手机都改过`}</Text>
              <Button
                title="去看看"
                kind="text"
                testID="remote-conflicts"
                disabled={busy || syncing}
                onPress={() => nav.navigate("Conflicts")}
              />
            </View>
          )}
          {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
          <View style={s.row}>
            <Button
              title={progress || (sync.running && !running ? "正在同步…" : "现在同步")}
              testID="remote-backup"
              disabled={busy || syncing}
              onPress={() => {
                void syncNow();
              }}
            />
            {stop}
          </View>
          <View style={s.row}>
            <Button
              title="查看恢复码"
              kind="text"
              compact
              testID="remote-code"
              disabled={busy || syncing}
              onPress={() => {
                void showCode();
              }}
            />
            <Button
              title="验证远端"
              kind="text"
              compact
              testID="remote-verify"
              disabled={busy || syncing}
              onPress={() => {
                void verify();
              }}
            />
            <Button
              title="退出一起写"
              kind="text"
              compact
              danger
              testID="remote-disable"
              disabled={busy || syncing}
              onPress={disable}
            />
          </View>
          {isOwner && (
            <Button
              title="删掉全家的远端"
              kind="text"
              compact
              danger
              testID="remote-wipe-family"
              disabled={busy || syncing}
              onPress={wipeFamily}
            />
          )}
          <Text style={s.footnote}>
            钥匙指纹 {remote.keyId.slice(0, 8)}
            。恢复码就是钥匙，丢了谁也打不开远端的内容；请抄在纸上收好。
          </Text>
        </>
      )}
    </Card>
  );
}
