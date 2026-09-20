import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as LocalAuthentication from "expo-local-authentication";
import { getToken } from "../ai/session";
import { BackupStopped } from "../local/backup";
import { useLibrary, useStore } from "../local/context";
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
import { runRemoteBackup, verifyRemoteBackup } from "./engine";
import { bytesLabel } from "./planner";
import {
  clearRemoteState,
  forgetKey,
  loadKey,
  readRemoteState,
  storeKey,
  writeRemoteState,
  type RemoteState,
} from "./state";
import { SyncError, createTransport } from "./transport";
/**
 * 备份页最后一张卡：远端备份的全部入口都在这里，普通记录流程见不到服务器。
 * 三态：未登录 → 去登录；已登录未开启 → 开启（生成钥匙、看恢复码）或从远端恢复；
 * 已开启 → 现在备份／查看恢复码／验证／从远端恢复／关闭。进度写在按钮标题里，错误是卡内一行红字。
 * 卡里有操作在跑时通过 onRunningChange 告诉备份页：本机备份、恢复、删除与远端上传都读写同一个
 * blob 库，不能同时进行。
 */
export function RemoteBackupCard({
  busy,
  onRunningChange,
}: {
  busy: boolean;
  onRunningChange?: (running: boolean) => void;
}) {
  const library = useLibrary(),
    store = useStore(),
    nav = useNav(),
    s = useStyles();
  const [signedIn, setSignedIn] = useState<boolean | null>(null),
    [remote, setRemote] = useState<RemoteState | null>(null),
    [progress, setProgress] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [token, state] = await Promise.all([
          getToken(),
          readRemoteState(),
        ]);
        if (cancelled) return;
        setSignedIn(!!token);
        setRemote(state);
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
  // 离开这一页就停止还在跑的上传：停止键跟着卡一起消失，不能让它在背后继续。
  useEffect(() => {
    const active = controller;
    return () => active.current?.abort();
  }, []);
  const running = !!progress;
  const perform = async (fn: (signal: AbortSignal) => Promise<void>) => {
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
      controller.current = null;
      setProgress("");
      onRunningChange?.(false);
      setRemote(await readRemoteState());
    }
  };
  const withKey = async (
    signal: AbortSignal,
    fn: (key: Uint8Array, signal: AbortSignal) => Promise<void>,
  ) => {
    const key = await loadKey();
    if (!key)
      throw new Error("这台手机上没有远端备份的钥匙，请先开启远端备份。");
    await fn(key, signal);
  };
  const backupNow = () =>
    perform((signal) =>
      withKey(signal, async (key) => {
        const result = await runRemoteBackup(store.get(), {
          transport: createTransport(),
          key,
          onProgress: setProgress,
          signal,
        });
        setMessage(
          `远端备份完成：${bytesLabel(result.lastBackupBytes ?? 0)}，${result.lastBackupObjects ?? 0} 份。`,
        );
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
          `远端完整：${dateLabel(summary.createdAt)} 的备份，${bytesLabel(summary.bytes)}，${summary.objects} 份都在。`,
        );
      }),
    );
  const enable = () =>
    perform(async () => {
      // 之前关过但没删远端：还是那把钥匙，恢复码不变。
      const key = (await loadKey()) ?? newMasterKey();
      await storeKey(key);
      writeRemoteState({
        ...(remote ?? {}),
        version: 1,
        enabled: true,
        keyId: keyIdOf(key),
      });
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
      "关闭远端备份？",
      "关闭后这台手机不再往远端备份。远端已有的备份可以留着（凭恢复码随时能恢复），也可以一起删掉。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "保留远端，只关闭",
          onPress: () => {
            void perform(async () => {
              if (remote) writeRemoteState({ ...remote, enabled: false });
              setMessage("已关闭。远端的备份还在，恢复码仍然有效。");
            });
          },
        },
        {
          text: "同时删除远端",
          style: "destructive",
          onPress: () => {
            void perform(async (signal) => {
              await createTransport().wipe(signal);
              await forgetKey();
              clearRemoteState();
              setMessage("已关闭，远端的备份已删除。");
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
      <Text style={s.heading}>远端备份</Text>
      {signedIn === false ? (
        <>
          <Text style={s.muted}>
            登录家人账号后，可以把加密后的照片和记录存到家人服务上。钥匙只在这台手机和你抄下的恢复码里，服务器看不到内容。
          </Text>
          <ErrorText message={error} />
          <View style={{ alignItems: "flex-start" }}>
            <Button
              title="去登录"
              kind="text"
              compact
              disabled={busy}
              onPress={() => nav.navigate("AISettings")}
            />
          </View>
        </>
      ) : !remote?.enabled ? (
        <>
          <Text style={s.muted}>
            开启后，照片和记录会加密存到家人服务上；换手机时输入 12
            个词的恢复码就能拿回来。服务器只见密文，看不到内容。
          </Text>
          <ErrorText message={error} />
          {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
          <View style={s.row}>
            <Button
              title="开启远端备份"
              testID="remote-enable"
              disabled={busy || running || signedIn === null}
              onPress={() => {
                void enable();
              }}
            />
            <Button
              title="从远端恢复"
              kind="text"
              compact
              testID="remote-restore"
              disabled={busy || running || signedIn === null}
              onPress={() => nav.navigate("RecoveryCode", { mode: "enter" })}
            />
          </View>
        </>
      ) : (
        <>
          <Text style={s.muted}>
            {remote.lastBackupAt
              ? `上次备份 ${dateLabel(remote.lastBackupAt)} · ${bytesLabel(remote.lastBackupBytes ?? 0)} · ${remote.lastBackupObjects ?? 0} 份`
              : "还没备份到远端。"}
          </Text>
          <ErrorText message={error} />
          {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
          <View style={s.row}>
            <Button
              title={progress || "现在备份"}
              testID="remote-backup"
              disabled={busy || running}
              onPress={() => {
                void backupNow();
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
              disabled={busy || running}
              onPress={() => {
                void showCode();
              }}
            />
            <Button
              title="验证远端备份"
              kind="text"
              compact
              testID="remote-verify"
              disabled={busy || running}
              onPress={() => {
                void verify();
              }}
            />
            <Button
              title="从远端恢复"
              kind="text"
              compact
              testID="remote-restore"
              disabled={busy || running}
              onPress={() => nav.navigate("RecoveryCode", { mode: "enter" })}
            />
            <Button
              title="关闭远端备份"
              kind="text"
              compact
              danger
              testID="remote-disable"
              disabled={busy || running}
              onPress={disable}
            />
          </View>
          <Text style={s.footnote}>
            钥匙指纹 {remote.keyId.slice(0, 8)}
            。恢复码丢了，远端的备份谁也打不开；请抄在纸上收好。
          </Text>
        </>
      )}
    </Card>
  );
}
