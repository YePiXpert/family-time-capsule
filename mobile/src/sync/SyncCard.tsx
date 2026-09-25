import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { BackupStopped } from "../local/backup";
import { useLibrary, useStore, useSyncStatus } from "../local/context";
import { useNav } from "../local/navigation";
import {
  Button,
  Card,
  ErrorText,
  Text,
  messageOf,
  useStyles,
  useTheme,
} from "../local/ui";
import { keyIdOf } from "./crypto";
import { runFamilySync, startSharing } from "./family";
import { claimSync, isLocalBusy, markSyncRunning } from "./status";
import { dateTimeLabel } from "../local/dates";
import { bytesLabel } from "./planner";
import {
  loadKey,
  readRemoteState,
  readConflicts,
  type RemoteState,
  unreadNotice,
  writeRemoteState,
} from "./state";
import { SyncError, createTransport, type RemoteStatus } from "./transport";
/**
 * 「家庭与同步」页的同步卡：只在已加入时出现，只读本机状态，服务连不上也照常显示。
 * 两态：还没完成第一次同步（给「开始第一次同步」），已同步（上次同步、冲突、现在同步、自动同步开关）。
 * 身份、设备、恢复码、退出在同一页的其他卡；验证远端与清空远端在管理者维护里。
 */
export function SyncCard({ busy }: { busy: boolean }) {
  const sync = useSyncStatus();
  const library = useLibrary(),
    store = useStore(),
    nav = useNav(),
    s = useStyles(),
    { colors } = useTheme();
  // useState 槽位：remote、progress、message、error、conflicts、localKeyId、status、statusError、savingAutoSync。
  // remote 为 undefined 表示还在读；null 表示这台手机还没开始同步。
  const [remote, setRemote] = useState<RemoteState | null | undefined>(
      undefined,
    ),
    [progress, setProgress] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [conflicts, setConflicts] = useState(0);
  const [localKeyId, setLocalKeyId] = useState<string | null>(null);
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [savingAutoSync, setSavingAutoSync] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    let cancelled = false;
    setStatus(null);
    setStatusError("");
    setError("");
    void (async () => {
      try {
        const [state, items, key] = await Promise.all([
          readRemoteState(),
          readConflicts(),
          loadKey(),
        ]);
        if (cancelled) return;
        setRemote(state);
        setConflicts(items.length);
        setLocalKeyId(key ? keyIdOf(key) : null);
        // 还没开始同步：问一下家里有没有人在写、远端钥匙是哪一把，决定说法。
        if (!state?.enabled)
          await createTransport()
            .status()
            .then((next) => {
              if (!cancelled) setStatus(next);
            })
            .catch((e: unknown) => {
              if (!cancelled) setStatusError(messageOf(e));
            });
      } catch (e) {
        // 钥匙串读不出来：别让卡上只剩「正在读取」。
        if (cancelled) return;
        setRemote(null);
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
    if (isLocalBusy()) {
      setMessage("本机正在备份或恢复，等它完成再试。");
      return;
    }
    if (!claimSync()) {
      setMessage("正在同步，等它完成再试。");
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setError("");
    setMessage("");
    setProgress("正在准备…");
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
      throw new Error("这台手机还没拿到家庭的钥匙，请退出家庭后重新加入。");
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
        const {
          pulled = 0,
          pushed = 0,
          conflicts = 0,
        } = result.lastSyncSummary ?? {};
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
  const records = Object.keys(library.records).length;
  /** 第一次同步：后果在按钮上面的说明里已经讲清（合并几段、先留本机备份），按了就开始。 */
  const firstSync = () =>
    perform((signal) =>
      withKey(signal, async (key) => {
        const result = await startSharing(store, key, {
          transport: createTransport(),
          onProgress: setProgress,
          signal,
        });
        setMessage(
          `第一次同步完成，${result.lastSyncSummary?.devices ?? 1} 台手机在一起写。${unreadNotice(result.lastSyncSummary)}`,
        );
      }),
    );
  const changeAutoSync = async (value: boolean) => {
    setSavingAutoSync(true);
    setError("");
    try {
      const current = await readRemoteState();
      if (current) {
        const next = { ...current, autoSync: value };
        writeRemoteState(next);
        setRemote(next);
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSavingAutoSync(false);
    }
  };
  const stop = running && (
    <Button
      title="停止"
      kind="text"
      compact
      testID="remote-stop"
      onPress={() => controller.current?.abort()}
    />
  );
  const live = !!(progress || message) && (
    <Text accessibilityLiveRegion="polite">{progress || message}</Text>
  );
  let body: React.ReactNode;
  if (remote === undefined) body = <Text style={s.muted}>正在读取…</Text>;
  else if (!remote?.enabled)
    body = (
      <>
        <Text>已加入，还没完成第一次同步。</Text>
        <ErrorText message={error} />
        {statusError ? (
          <>
            <ErrorText message={statusError} />
            <View style={{ alignItems: "flex-start" }}>
              <Button
                title="再试一次"
                kind="text"
                compact
                disabled={busy || syncing}
                onPress={() => {
                  refresh();
                }}
              />
            </View>
          </>
        ) : !status ? (
          !error && <Text style={s.muted}>正在看看家里有没有人在写…</Text>
        ) : !localKeyId ? (
          <ErrorText message="这台手机还没拿到家庭的钥匙，请退出家庭后重新加入。" />
        ) : status.keyId && status.keyId !== localKeyId ? (
          <ErrorText message="这台手机的钥匙和家里远端的对不上，请退出家庭后重新加入。" />
        ) : (
          <>
            <Text style={s.muted}>
              {status.manifests > 0
                ? records > 0
                  ? `第一次同步会把这台手机上已有的 ${records} 段时光和家人的合在一起，开始前先在本机留一份备份；草稿仍只在这台手机上。`
                  : "第一次同步会把家人的时光和照片下载到这台手机，建议连着 Wi‑Fi。"
                : "家里还没有人同步过。第一次同步会把这台手机的时光加密后传上去，家人的手机再同步就能看到；草稿仍只在这台手机上。"}
            </Text>
            {live}
            <View style={s.row}>
              <Button
                title={progress || "开始第一次同步"}
                primary
                testID="remote-first-sync"
                disabled={busy || syncing}
                onPress={() => {
                  void firstSync();
                }}
              />
              {stop}
            </View>
          </>
        )}
      </>
    );
  else
    body = (
      <>
        <Text style={s.muted}>
          {remote.lastSyncAt
            ? `上次同步 ${dateTimeLabel(remote.lastSyncAt)} · ${remote.lastSyncSummary?.devices ?? 1} 台手机 · ${bytesLabel(remote.lastSyncSummary?.bytes ?? 0)}`
            : "还没同步过。"}
        </Text>
        {!syncing && !!unreadNotice(remote.lastSyncSummary) && (
          <Text style={s.muted}>{unreadNotice(remote.lastSyncSummary)}</Text>
        )}
        <ErrorText
          message={error || (!syncing ? remote.lastError : "") || ""}
        />
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
            title={
              progress || (sync.running && !running ? "正在同步…" : "现在同步")
            }
            testID="remote-backup"
            disabled={busy || syncing}
            onPress={() => {
              void syncNow();
            }}
          />
          {stop}
        </View>
        <View
          style={[
            s.between,
            {
              paddingTop: 12,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.line,
            },
          ]}
        >
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text>回到应用时自动同步</Text>
            <Text style={s.muted}>
              回到应用、保存一段时光后 30
              秒，自动与家人合一次。照片一起下，流量敏感时可以关掉，手动点「现在同步」照常。
            </Text>
          </View>
          <Switch
            accessibilityLabel="回到应用时自动同步"
            testID="auto-sync-toggle"
            value={remote.autoSync === true}
            disabled={savingAutoSync}
            trackColor={{ false: colors.line, true: colors.accentSoft }}
            thumbColor={remote.autoSync ? colors.accent : undefined}
            onValueChange={(value) => {
              void changeAutoSync(value);
            }}
          />
        </View>
      </>
    );
  return (
    <Card testID="remote-card">
      <Text style={s.heading}>同步</Text>
      {body}
    </Card>
  );
}
